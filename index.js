/**
 * 피치 매니저 (Peach Manager)
 * 키보드 단축키 → STscript 명령어(QR 실행 포함) 매핑 확장.
 * 마법봉 메뉴에는 뜨지 않고, Extensions 탭 설정 패널에서만 관리합니다.
 */

const MODULE_NAME = 'peach-manager';

function ctx() {
    return SillyTavern.getContext();
}

const defaultSettings = {
    enabled: true,
    showToast: true,
    shortcuts: [], // { id, keyCombo, label, command }
};

function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const s = extensionSettings[MODULE_NAME];
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (s[k] === undefined) s[k] = structuredClone(v);
    }
    return s;
}

function saveSettings() {
    ctx().saveSettingsDebounced();
}

function newId() {
    return 'pm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ═══════════════════════════════════════════
// 키 조합 문자열 처리
// ═══════════════════════════════════════════
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

const KEY_LABELS = {
    ' ': 'Space',
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'Escape': 'Esc',
};

function normalizeKeyName(key) {
    if (KEY_LABELS[key]) return KEY_LABELS[key];
    if (key.length === 1) return key.toUpperCase();
    return key;
}

function comboFromEvent(event) {
    if (MODIFIER_KEYS.has(event.key)) return null; // 조합키 단독으로는 등록 불가
    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Meta');
    parts.push(normalizeKeyName(event.key));
    return parts.join('+');
}

function comboModifierParts(comboStr) {
    const parts = comboStr.split('+');
    parts.pop(); // 마지막 요소는 실제 키 이름이라 제외
    return parts;
}

function hasStrongModifier(comboStr) {
    const mods = comboModifierParts(comboStr);
    return mods.includes('Ctrl') || mods.includes('Alt') || mods.includes('Meta');
}

function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    return false;
}

// ═══════════════════════════════════════════
// 전역 키 리스너
// ═══════════════════════════════════════════
let capturingRow = null; // 지금 키 입력을 기다리는 중인 row id

function onGlobalKeydown(event) {
    // 캡처 모드 중이면 단축키 실행 대신 캡처 처리
    if (capturingRow) {
        handleCapture(event);
        return;
    }

    const settings = getSettings();
    if (!settings.enabled) return;
    if (event.repeat) return;

    const combo = comboFromEvent(event);
    if (!combo) return;

    // 입력창/텍스트박스에 타이핑 중이면, 조합키(Ctrl/Alt/Meta)가 없는 단축키는 무시
    if (isTypingTarget(document.activeElement) && !hasStrongModifier(combo)) return;

    const match = settings.shortcuts.find(s => s.keyCombo === combo);
    if (!match || !match.command) return;

    event.preventDefault();
    event.stopPropagation();

    runCommand(match);
}

async function runCommand(shortcut) {
    try {
        const c = ctx();
        await c.executeSlashCommandsWithOptions(shortcut.command, {
            handleParserErrors: true,
            handleExecutionErrors: true,
        });
        const settings = getSettings();
        if (settings.showToast && c.toastr?.info) {
            c.toastr.info(`⌨️ ${shortcut.label || shortcut.keyCombo} 실행됨`, '', { timeOut: 1500 });
        }
    } catch (e) {
        console.error(`[${MODULE_NAME}] 명령 실행 실패`, e);
        ctx().toastr?.error?.(`⌨️ 단축키 실행 실패: ${e?.message || e}`, '피치 매니저');
    }
}

// ═══════════════════════════════════════════
// 키 캡처 (설정 패널에서 "키 입력" 버튼 눌렀을 때)
// ═══════════════════════════════════════════
function startCapture(rowId, buttonEl) {
    // 기존에 캡처 중이던 게 있으면 취소
    if (capturingRow) cancelCapture();

    capturingRow = { rowId, buttonEl };
    buttonEl.textContent = '키를 누르세요…';
    buttonEl.closest('.pm-row')?.classList.add('capturing');
}

function cancelCapture() {
    if (!capturingRow) return;
    const settings = getSettings();
    const row = settings.shortcuts.find(s => s.id === capturingRow.rowId);
    capturingRow.buttonEl.textContent = row?.keyCombo || '키 입력';
    capturingRow.buttonEl.closest('.pm-row')?.classList.remove('capturing');
    capturingRow = null;
}

function handleCapture(event) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
        cancelCapture();
        return;
    }
    if (MODIFIER_KEYS.has(event.key)) return; // 조합키만 누른 상태면 계속 대기

    const combo = comboFromEvent(event);
    if (!combo) return;

    if (!hasStrongModifier(combo)) {
        capturingRow.buttonEl.textContent = 'Ctrl 또는 Alt 포함해서 다시!';
        setTimeout(() => {
            if (capturingRow) capturingRow.buttonEl.textContent = '키를 누르세요…';
        }, 1200);
        return; // 저장하지 않고 계속 대기
    }

    const settings = getSettings();
    const row = settings.shortcuts.find(s => s.id === capturingRow.rowId);
    if (row) {
        row.keyCombo = combo;
        saveSettings();
        checkDuplicateAndWarn(combo, row.id);
    }
    capturingRow.buttonEl.closest('.pm-row')?.classList.remove('capturing');
    capturingRow = null;
    renderList();
}

function checkDuplicateAndWarn(combo, excludeId) {
    const settings = getSettings();
    const dupes = settings.shortcuts.filter(s => s.keyCombo === combo && s.id !== excludeId);
    if (dupes.length > 0) {
        const names = dupes.map(d => d.label || d.keyCombo).join(', ');
        ctx().toastr?.warning?.(`⌨️ "${combo}" 는 이미 다른 항목(${names})에서 쓰고 있어요.`, '피치 매니저', { timeOut: 4000 });
    }
}

// ═══════════════════════════════════════════
// 설정 패널 렌더링
// ═══════════════════════════════════════════
function renderList() {
    const $list = $('#pm-list');
    if (!$list.length) return;
    const settings = getSettings();
    $list.empty();

    if (!settings.shortcuts.length) {
        $list.append('<div class="pm-empty">등록된 단축키가 없어요. 아래 "단축키 추가"로 시작하세요.</div>');
        return;
    }

    for (const row of settings.shortcuts) {
        const $row = $(`
            <div class="pm-row" data-id="${row.id}">
                <div class="pm-row-top">
                    <button class="pm-capture menu_button" type="button">${row.keyCombo ? escapeHtml(row.keyCombo) : '키 입력'}</button>
                    <input type="text" class="pm-label text_pole" placeholder="이름 (예: 키스)" value="${escapeAttr(row.label || '')}">
                    <button class="pm-delete menu_button" type="button" title="삭제">🗑</button>
                </div>
                <div class="pm-row-bottom">
                    <input type="text" class="pm-command text_pole" placeholder='명령어 (예: /run &quot;키스&quot;)' value="${escapeAttr(row.command || '')}">
                    <button class="pm-fill-qr menu_button" type="button" title="QR 라벨로 채우기">🏷</button>
                </div>
            </div>
        `);
        $list.append($row);
    }
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function bindListEvents() {
    const $list = $('#pm-list');

    $list.on('click', '.pm-capture', function () {
        const rowId = $(this).closest('.pm-row').data('id');
        startCapture(rowId, this);
    });

    $list.on('click', '.pm-delete', function () {
        const rowId = $(this).closest('.pm-row').data('id');
        const settings = getSettings();
        settings.shortcuts = settings.shortcuts.filter(s => s.id !== rowId);
        saveSettings();
        renderList();
    });

    $list.on('click', '.pm-fill-qr', function () {
        const label = window.prompt('실행할 QR의 라벨을 정확히 입력하세요 (예: 키스)\n\n"/run" 명령어는 현재 활성화된 QR 세트들 안에서 이 라벨을 찾아 실행합니다.');
        if (!label) return;
        const $cmd = $(this).closest('.pm-row').find('.pm-command');
        $cmd.val(`/run "${label}"`).trigger('change');
    });

    $list.on('change', '.pm-label', function () {
        const rowId = $(this).closest('.pm-row').data('id');
        const settings = getSettings();
        const row = settings.shortcuts.find(s => s.id === rowId);
        if (row) { row.label = $(this).val(); saveSettings(); }
    });

    $list.on('change', '.pm-command', function () {
        const rowId = $(this).closest('.pm-row').data('id');
        const settings = getSettings();
        const row = settings.shortcuts.find(s => s.id === rowId);
        if (row) { row.command = $(this).val(); saveSettings(); }
    });
}

function addRow() {
    const settings = getSettings();
    settings.shortcuts.push({ id: newId(), keyCombo: '', label: '', command: '' });
    saveSettings();
    renderList();
}

function renderSettingsPanel() {
    const settings = getSettings();
    $('#extensions_settings2').append(`
        <div id="peach-manager-panel">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🍑 Peach Manager</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="pm-tip">
                        <b>이렇게 쓰세요</b>
                        1. 키 버튼 누르고 원하는 키 조합 입력 (Ctrl 또는 Alt 꼭 포함)<br>
                        2. 명령어 칸에 실행할 명령 입력 (QR이면 🏷 버튼으로 자동 채우기)
                    </div>
                    <div class="pm-toprow">
                        <label class="checkbox_label">
                            <input type="checkbox" id="pm-enabled" ${settings.enabled ? 'checked' : ''}>
                            기능 켜기
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="pm-toast" ${settings.showToast ? 'checked' : ''}>
                            실행 알림 표시
                        </label>
                    </div>
                    <div id="pm-list" class="pm-list"></div>
                    <button id="pm-add" class="menu_button pm-add" type="button">➕ 단축키 추가</button>
                </div>
            </div>
        </div>
    `);

    $('#pm-enabled').on('change', function () {
        getSettings().enabled = $(this).is(':checked');
        saveSettings();
    });
    $('#pm-toast').on('change', function () {
        getSettings().showToast = $(this).is(':checked');
        saveSettings();
    });
    $('#pm-add').on('click', addRow);

    bindListEvents();
    renderList();
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
function init() {
    getSettings();
    renderSettingsPanel();
    document.addEventListener('keydown', onGlobalKeydown, true);
    console.log(`[${MODULE_NAME}] 로드 완료`);
}

(function bootstrap() {
    const context = SillyTavern.getContext();
    if (context?.eventSource && context?.eventTypes?.APP_READY) {
        context.eventSource.on(context.eventTypes.APP_READY, init);
    }
    setTimeout(() => {
        if (!document.getElementById('peach-manager-panel')) init();
    }, 1500);
})();
