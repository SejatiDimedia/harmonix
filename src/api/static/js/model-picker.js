/**
 * Model Management & Dynamic Provider Switcher (FR-36)
 */

import { appState, escapeHtml, formatModelNameShort, showToast } from './state.js';

export async function fetchModelCatalog(onCatalogLoaded) {
    try {
        const res = await fetch('/v1/models');
        if (!res.ok) return;
        appState.modelCatalog = await res.json();
        
        if (appState.modelCatalog.active_config) {
            appState.activeAnalystProvider = appState.modelCatalog.active_config.analyst_provider || 'groq';
            appState.activeAnalystModel = appState.modelCatalog.active_config.analyst_model || '';
            appState.activeAuditorProvider = appState.modelCatalog.active_config.auditor_provider || 'auto';
            appState.activeAuditorModel = appState.modelCatalog.active_config.auditor_model || '';
        }
        updateBadgeLabel();
        renderProviderStatusGrid();
        renderInputModelPopover();
        if (typeof onCatalogLoaded === 'function') {
            onCatalogLoaded(appState.modelCatalog);
        }
    } catch (err) {
        console.error("Failed to load model catalog:", err);
    }
}

export function updateBadgeLabel() {
    const activeModelBadge = document.getElementById('activeModelBadge');
    const inputModelLabel = document.getElementById('inputModelLabel');
    const shortName = formatModelNameShort(appState.activeAnalystModel) || appState.activeAnalystProvider;
    const fullLabel = `${appState.activeAnalystProvider.toUpperCase()}: ${shortName}`;
    if (activeModelBadge) {
        activeModelBadge.textContent = fullLabel;
        activeModelBadge.title = `Analyst: ${appState.activeAnalystProvider} (${appState.activeAnalystModel}) | Auditor: ${appState.activeAuditorProvider} (${appState.activeAuditorModel || 'auto'})`;
    }
    if (inputModelLabel) {
        inputModelLabel.textContent = fullLabel;
        inputModelLabel.title = `Model Aktif: ${appState.activeAnalystProvider.toUpperCase()} (${appState.activeAnalystModel})`;
    }
}

export function renderProviderStatusGrid() {
    const providerStatusGrid = document.getElementById('providerStatusGrid');
    if (!providerStatusGrid || !appState.modelCatalog || !appState.modelCatalog.providers) return;
    providerStatusGrid.innerHTML = '';
    appState.modelCatalog.providers.forEach(p => {
        const pill = document.createElement('div');
        pill.className = `p-2 rounded-lg border flex flex-col justify-between gap-1 ${
            p.is_ready ? 'bg-[#18231c] border-emerald-900/60 text-emerald-300' : 'bg-[#221c1a] border-[#3d2a26] text-[#9c9990]'
        }`;
        pill.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="font-medium text-[#f5f4ef] text-[11px]">${escapeHtml(p.provider.toUpperCase())}</span>
                <span class="w-1.5 h-1.5 rounded-full ${p.is_ready ? 'bg-emerald-400' : 'bg-amber-500'}"></span>
            </div>
            <span class="text-[10px] truncate text-[#a3a097]">${escapeHtml(p.status_message || '')}</span>
        `;
        providerStatusGrid.appendChild(pill);
    });
}

export function populateModalOptions() {
    const selectAnalystProvider = document.getElementById('selectAnalystProvider');
    const selectAuditorProvider = document.getElementById('selectAuditorProvider');
    if (!appState.modelCatalog || !appState.modelCatalog.providers || !selectAnalystProvider || !selectAuditorProvider) return;

    // 1. Populate Analyst Providers
    selectAnalystProvider.innerHTML = '';
    appState.modelCatalog.providers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.provider;
        opt.textContent = `${p.display_name}${p.is_ready ? '' : ' (Key Belum Ada)'}`;
        if (p.provider === appState.activeAnalystProvider) opt.selected = true;
        selectAnalystProvider.appendChild(opt);
    });

    // 2. Populate Auditor Providers
    selectAuditorProvider.innerHTML = '<option value="auto">Auto (Model Diversity)</option>';
    appState.modelCatalog.providers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.provider;
        opt.textContent = `${p.display_name}${p.is_ready ? '' : ' (Key Belum Ada)'}`;
        if (p.provider === appState.activeAuditorProvider) opt.selected = true;
        selectAuditorProvider.appendChild(opt);
    });

    syncAnalystModels();
    syncAuditorModels();
}

export function syncAnalystModels() {
    const selectAnalystProvider = document.getElementById('selectAnalystProvider');
    const selectAnalystModel = document.getElementById('selectAnalystModel');
    if (!appState.modelCatalog || !selectAnalystProvider || !selectAnalystModel) return;
    const provId = selectAnalystProvider.value;
    const provData = appState.modelCatalog.providers.find(p => p.provider === provId);
    selectAnalystModel.innerHTML = '';

    if (provData && provData.available_models) {
        provData.available_models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            if (m.id === appState.activeAnalystModel) opt.selected = true;
            selectAnalystModel.appendChild(opt);
        });
    }

    if (!selectAnalystModel.value && selectAnalystModel.options.length > 0) {
        selectAnalystModel.selectedIndex = 0;
    }
    updateAnalystDesc();
}

export function updateAnalystDesc() {
    const selectAnalystProvider = document.getElementById('selectAnalystProvider');
    const selectAnalystModel = document.getElementById('selectAnalystModel');
    const analystModelDesc = document.getElementById('analystModelDesc');
    if (!appState.modelCatalog || !selectAnalystProvider || !selectAnalystModel || !analystModelDesc) return;
    const provId = selectAnalystProvider.value;
    const modelId = selectAnalystModel.value;
    const provData = appState.modelCatalog.providers.find(p => p.provider === provId);
    if (provData && provData.available_models) {
        const m = provData.available_models.find(x => x.id === modelId);
        if (m) {
            analystModelDesc.textContent = `${m.description || ''} • Konteks: ${(m.context_length || 8192).toLocaleString()} token`;
            return;
        }
    }
    analystModelDesc.textContent = '';
}

export function syncAuditorModels() {
    const selectAuditorProvider = document.getElementById('selectAuditorProvider');
    const selectAuditorModel = document.getElementById('selectAuditorModel');
    if (!appState.modelCatalog || !selectAuditorProvider || !selectAuditorModel) return;
    const provId = selectAuditorProvider.value;
    selectAuditorModel.innerHTML = '';

    if (provId === 'auto') {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Auto / Fallback Provider';
        selectAuditorModel.appendChild(opt);
        selectAuditorModel.disabled = true;
        updateAuditorDesc();
        return;
    }

    selectAuditorModel.disabled = false;
    const provData = appState.modelCatalog.providers.find(p => p.provider === provId);
    if (provData && provData.available_models) {
        provData.available_models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            if (m.id === appState.activeAuditorModel) opt.selected = true;
            selectAuditorModel.appendChild(opt);
        });
    }

    if (!selectAuditorModel.value && selectAuditorModel.options.length > 0) {
        selectAuditorModel.selectedIndex = 0;
    }
    updateAuditorDesc();
}

export function updateAuditorDesc() {
    const selectAuditorProvider = document.getElementById('selectAuditorProvider');
    const selectAuditorModel = document.getElementById('selectAuditorModel');
    const auditorModelDesc = document.getElementById('auditorModelDesc');
    if (!appState.modelCatalog || !selectAuditorProvider || !selectAuditorModel || !auditorModelDesc) return;
    const provId = selectAuditorProvider.value;
    if (provId === 'auto') {
        auditorModelDesc.textContent = 'Auditor akan memilih model independen yang berbeda secara otomatis untuk validasi maker-checker.';
        return;
    }
    const modelId = selectAuditorModel.value;
    const provData = appState.modelCatalog.providers.find(p => p.provider === provId);
    if (provData && provData.available_models) {
        const m = provData.available_models.find(x => x.id === modelId);
        if (m) {
            auditorModelDesc.textContent = `${m.description || ''} • Konteks: ${(m.context_length || 8192).toLocaleString()} token`;
            return;
        }
    }
    auditorModelDesc.textContent = '';
}

export function openModelModal() {
    const modelModal = document.getElementById('modelModal');
    if (!modelModal) return;
    populateModalOptions();
    modelModal.classList.remove('hidden');
}

export function closeModelModal() {
    const modelModal = document.getElementById('modelModal');
    const modelModalFeedback = document.getElementById('modelModalFeedback');
    if (!modelModal) return;
    modelModal.classList.add('hidden');
    if (modelModalFeedback) modelModalFeedback.classList.add('hidden');
}

export async function saveModelModal(onHealthCheck) {
    const btnSaveModelModal = document.getElementById('btnSaveModelModal');
    const modelModalFeedback = document.getElementById('modelModalFeedback');
    const selectAnalystProvider = document.getElementById('selectAnalystProvider');
    const selectAnalystModel = document.getElementById('selectAnalystModel');
    const selectAuditorProvider = document.getElementById('selectAuditorProvider');
    const selectAuditorModel = document.getElementById('selectAuditorModel');

    if (!btnSaveModelModal || !selectAnalystProvider || !selectAnalystModel) return;

    btnSaveModelModal.disabled = true;
    btnSaveModelModal.textContent = 'Menyimpan...';

    const payload = {
        analyst_provider: selectAnalystProvider.value,
        analyst_model: selectAnalystModel.value,
        auditor_provider: selectAuditorProvider ? selectAuditorProvider.value : 'auto',
        auditor_model: selectAuditorModel && selectAuditorModel.value ? selectAuditorModel.value : null
    };

    try {
        const res = await fetch('/v1/models/active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            appState.activeAnalystProvider = payload.analyst_provider;
            appState.activeAnalystModel = payload.analyst_model;
            appState.activeAuditorProvider = payload.auditor_provider;
            appState.activeAuditorModel = payload.auditor_model || '';

            updateBadgeLabel();
            renderInputModelPopover();
            showToast(`Model Aktif: ${appState.activeAnalystProvider.toUpperCase()} (${formatModelNameShort(appState.activeAnalystModel)})`);
            closeModelModal();
            if (typeof onHealthCheck === 'function') onHealthCheck();
        } else {
            if (modelModalFeedback) {
                modelModalFeedback.textContent = data.detail || 'Gagal memperbarui konfigurasi model.';
                modelModalFeedback.classList.remove('hidden');
            }
        }
    } catch (err) {
        if (modelModalFeedback) {
            modelModalFeedback.textContent = `Error: ${err.message}`;
            modelModalFeedback.classList.remove('hidden');
        }
    } finally {
        btnSaveModelModal.disabled = false;
        btnSaveModelModal.textContent = 'Simpan & Terapkan';
    }
}

export function renderInputModelPopover() {
    const inputModelGroupsList = document.getElementById('inputModelGroupsList');
    if (!inputModelGroupsList || !appState.modelCatalog || !appState.modelCatalog.providers) return;
    inputModelGroupsList.innerHTML = '';

    appState.modelCatalog.providers.forEach(p => {
        if (!p.available_models || p.available_models.length === 0) return;

        const groupEl = document.createElement('div');
        groupEl.className = 'border-b border-[#2d2b27] pb-2 last:border-b-0 last:pb-0';

        const groupTitle = document.createElement('div');
        groupTitle.className = 'px-3 py-1 flex items-center justify-between text-[10px] font-mono font-medium text-[#9c9990] uppercase tracking-wider';
        groupTitle.innerHTML = `
            <span>${escapeHtml(p.display_name)}</span>
            <span class="w-1.5 h-1.5 rounded-full ${p.is_ready ? 'bg-emerald-400' : 'bg-amber-500'}"></span>
        `;
        groupEl.appendChild(groupTitle);

        p.available_models.forEach(m => {
            const isSelected = (p.provider === appState.activeAnalystProvider && m.id === appState.activeAnalystModel);
            const itemBtn = document.createElement('button');
            itemBtn.type = 'button';
            itemBtn.className = `w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition cursor-pointer ${
                isSelected 
                    ? 'bg-clay-600/20 text-[#f5f4ef] font-medium border border-clay-500/40 shadow-sm' 
                    : 'text-[#d6d4cb] hover:bg-[#282623] hover:text-white border border-transparent'
            }`;
            
            const shortName = formatModelNameShort(m.id) || m.name;
            itemBtn.innerHTML = `
                <div class="flex flex-col min-w-0 pr-2">
                    <span class="truncate font-sans">${escapeHtml(shortName)}</span>
                    <span class="text-[10px] text-[#8e8b82] font-mono truncate">${escapeHtml(m.id)}</span>
                </div>
                ${isSelected ? '<span class="text-clay-400 font-mono text-xs shrink-0">✓</span>' : ''}
            `;

            itemBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectModelFromPopover(p.provider, m.id);
            });

            groupEl.appendChild(itemBtn);
        });

        inputModelGroupsList.appendChild(groupEl);
    });
}

export async function selectModelFromPopover(provider, modelId) {
    try {
        const res = await fetch('/v1/models/active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                analyst_provider: provider,
                analyst_model: modelId,
                auditor_provider: appState.activeAuditorProvider,
                auditor_model: appState.activeAuditorModel || null
            })
        });

        if (res.ok) {
            appState.activeAnalystProvider = provider;
            appState.activeAnalystModel = modelId;
            updateBadgeLabel();
            closeInputModelPopover();
            renderInputModelPopover();
            showToast(`Model aktif: ${provider.toUpperCase()} (${formatModelNameShort(modelId)})`);
        } else {
            showToast('Gagal mengubah model.');
        }
    } catch (err) {
        showToast(`Error: ${err.message}`);
    }
}

export function openInputModelPopover() {
    const inputModelPopover = document.getElementById('inputModelPopover');
    if (!inputModelPopover) return;
    renderInputModelPopover();
    inputModelPopover.classList.remove('hidden');
}

export function closeInputModelPopover() {
    const inputModelPopover = document.getElementById('inputModelPopover');
    if (!inputModelPopover) return;
    inputModelPopover.classList.add('hidden');
}

export function toggleInputModelPopover() {
    const inputModelPopover = document.getElementById('inputModelPopover');
    if (!inputModelPopover) return;
    if (inputModelPopover.classList.contains('hidden')) {
        openInputModelPopover();
    } else {
        closeInputModelPopover();
    }
}
