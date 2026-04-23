const DB_NAME = 'IlianaTrackDB';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('store')) {
                db.createObjectStore('store');
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function idbGet(key) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readonly');
        const store = tx.objectStore('store');
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }));
}

function idbSet(key, value) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction('store', 'readwrite');
        const store = tx.objectStore('store');
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    }));
}

class PCBAMaterialManager {
    constructor() {
        this.materials = [];
        this.equipment = [];
        this.tips = [];
        
        this.currentPart = null;
        this.db = null;
        this.currentView = 'inventory';
        
        this.init();
        this.initFirebase();
        this.setupScanner();
        this.requestPersistentStorage();
        
        // Carga asíncrona desde IndexedDB con migración automática
        this.loadLocalData().then(() => {
            this.render();
        });
    }

    async requestPersistentStorage() {
        if (navigator.storage && navigator.storage.persist) {
            try {
                const isPersisted = await navigator.storage.persist();
                console.log(`Persisted storage granted: ${isPersisted}`);
            } catch (err) {
                console.log("Persistence request failed", err);
            }
        }
    }

    async loadLocalData() {
        // Migración automática de localStorage a IndexedDB
        const keys = ['iliana_inventory', 'iliana_equipment', 'iliana_tips'];
        for (const key of keys) {
            const oldData = localStorage.getItem(key);
            if (oldData) {
                try {
                    const parsed = JSON.parse(oldData);
                    await idbSet(key, parsed);
                    localStorage.removeItem(key);
                } catch(e) { console.error("Error migrando " + key, e); }
            }
        }

        this.materials = (await idbGet('iliana_inventory')) || [];
        this.equipment = (await idbGet('iliana_equipment')) || [];
        this.tips = (await idbGet('iliana_tips')) || [];
    }

    init() {
        // Elements
        this.inventoryList = document.getElementById('inventory-list');
        this.searchInput = document.getElementById('search-input');
        
        // Navigation & Bottom Sheet
        this.bottomSheet = document.getElementById('bottom-sheet');
        this.sheetHandle = document.getElementById('sheet-handle');
        this.navItems = document.querySelectorAll('.nav-item');
        this.initBottomSheet();

        this.navItems.forEach(item => {
            item.addEventListener('click', () => {
                this.switchView(item.dataset.view);
                this.closeBottomSheet();
            });
        });

        // Theme
        this.darkModeBtn = document.getElementById('dark-mode-btn');
        this.initTheme();
        if (this.darkModeBtn) this.darkModeBtn.addEventListener('click', () => this.toggleDarkMode());

        // CSV Import/Export (Global)
        this.importTrigger = document.getElementById('import-csv-trigger-global');
        this.importInput = document.getElementById('import-csv-global');
        this.exportBtn = document.getElementById('export-csv-global');
        
        if (this.importTrigger) this.importTrigger.addEventListener('click', () => this.importInput.click());
        if (this.importInput) this.importInput.addEventListener('change', (e) => this.handleCSVImport(e));
        if (this.exportBtn) this.exportBtn.addEventListener('click', () => this.exportToCSV());

        // Help & Config Modals
        this.helpBtn = document.getElementById('help-btn');
        this.helpModal = document.getElementById('help-modal');
        this.closeHelpBtn = document.getElementById('close-help-btn');
        this.configBtn = document.getElementById('config-btn');
        this.configModal = document.getElementById('config-modal');
        this.closeConfigBtn = document.getElementById('close-config-btn');
        this.saveConfigBtn = document.getElementById('save-config-btn');
        this.installBtn = document.getElementById('install-app-btn');

        // Form Elements
        this.materialModal = document.getElementById('material-modal');
        this.logModal = document.getElementById('log-modal');
        this.fab = document.getElementById('fab');
        this.saveBtn = document.getElementById('save-btn');
        this.cancelBtn = document.getElementById('cancel-btn');
        this.confirmLogBtn = document.getElementById('confirm-log-btn');
        this.cancelLogBtn = document.getElementById('cancel-log-btn');
        this.exportBtn = document.getElementById('export-csv');
        this.scanBtn = document.getElementById('scan-btn');
        this.imageInput = document.getElementById('material-image');
        
        // Listeners
        // if (this.fab) this.fab.addEventListener('click', () => this.showMaterialModal()); // Old FAB listener
        // Module Add Buttons
        document.getElementById('add-equipment-btn')?.addEventListener('click', () => this.showModal('equipment-modal'));
        document.getElementById('add-tip-btn')?.addEventListener('click', () => this.showModal('tip-modal'));
        
        // Modal Actions (Equipment)
        document.getElementById('save-equipment-btn')?.addEventListener('click', () => this.addEquipment());
        document.getElementById('cancel-equipment-btn')?.addEventListener('click', () => this.hideModal('equipment-modal'));
        
        // Modal Actions (Tips)
        document.getElementById('save-tip-btn')?.addEventListener('click', () => this.addTip());
        document.getElementById('cancel-tip-btn')?.addEventListener('click', () => this.hideModal('tip-modal'));

        // FAB logic
        if (this.fab) {
            this.fab.addEventListener('click', () => {
                if (this.currentView === 'inventory') this.showMaterialModal();
                else if (this.currentView === 'equipment') this.showModal('equipment-modal');
                else if (this.currentView === 'technicians') this.showModal('tip-modal');
            });
        }

        if (this.cancelBtn) this.cancelBtn.addEventListener('click', () => this.hideModal('material-modal'));
        if (this.saveBtn) this.saveBtn.addEventListener('click', () => this.addMaterial());

        if (this.helpBtn) this.helpBtn.addEventListener('click', () => this.helpModal.style.display = 'flex');
        if (this.closeHelpBtn) this.closeHelpBtn.addEventListener('click', () => this.helpModal.style.display = 'none');
        
        if (this.configBtn) this.configBtn.addEventListener('click', () => this.showConfigModal());
        if (this.closeConfigBtn) this.closeConfigBtn.addEventListener('click', () => this.hideModal('config-modal'));
        if (this.saveConfigBtn) this.saveConfigBtn.addEventListener('click', () => this.saveFirebaseConfig());
        
        if (this.scanBtn) this.scanBtn.addEventListener('click', () => this.toggleScanner());

        this.setupInstallPrompt();

        if (this.cancelLogBtn) this.cancelLogBtn.addEventListener('click', () => this.hideModal('log-modal'));
        if (this.confirmLogBtn) this.confirmLogBtn.addEventListener('click', () => this.updateStock());
        
        this.editBtn = document.getElementById('edit-btn');
        this.deleteBtn = document.getElementById('delete-btn');
        if (this.editBtn) this.editBtn.addEventListener('click', () => this.editMaterial());
        if (this.deleteBtn) this.deleteBtn.addEventListener('click', () => this.deleteMaterial());

        const plus = document.getElementById('plus-qty');
        const minus = document.getElementById('minus-qty');
        if (plus) plus.addEventListener('click', () => this.adjustUpdateQty(1));
        if (minus) minus.addEventListener('click', () => this.adjustUpdateQty(-1));
        
        if (this.searchInput) this.searchInput.addEventListener('input', () => this.render());
        
        // Close modals on click outside
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) e.target.style.display = 'none';
        });

        // Maintenance Modals
        this.maintModal = document.getElementById('maintenance-modal');
        this.historyModal = document.getElementById('history-modal');
        
        document.getElementById('save-maint-btn')?.addEventListener('click', () => this.saveMaintenance());
        document.getElementById('cancel-maint-btn')?.addEventListener('click', () => this.hideModal('maintenance-modal'));
        document.getElementById('close-history-btn')?.addEventListener('click', () => this.hideModal('history-modal'));

        // Image previews
        if (this.imageInput) this.imageInput.addEventListener('change', (e) => this.handleImage(e, 'currentMaterialImage', 'image-preview'));
        document.getElementById('eq-image-input')?.addEventListener('change', (e) => this.handleImage(e, 'currentEquipmentImage', 'eq-image-preview'));
        document.getElementById('tip-image-input')?.addEventListener('change', (e) => this.handleImage(e, 'currentTipImage', 'tip-image-preview'));
    }

    initFirebase() {
        if (typeof firebase === 'undefined') {
            console.warn("Firebase SDK no cargado. Funcionando en modo local.");
            return;
        }

        // Credenciales Centralizadas para Iliana Track
        const firebaseConfig = {
            apiKey: "AIzaSyCGs6D6TS5owqyeXgpYgnEgpWTMWx2XsZo",
            authDomain: "jb-dashboard-86c3d.firebaseapp.com",
            databaseURL: "https://jb-dashboard-86c3d-default-rtdb.firebaseio.com",
            projectId: "jb-dashboard-86c3d",
            storageBucket: "jb-dashboard-86c3d.firebasestorage.app",
            messagingSenderId: "840492917794",
            appId: "1:840492917794:web:e772b643d3a5e89a09567b"
        };

        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
            this.db = firebase.database();
            console.log("✅ Firebase Sincronizado para Iliana Track");
            this.updateSyncStatus(true);
            this.startSync();
        } catch (e) {
            console.error("Firebase Init Error", e);
            this.updateSyncStatus(false);
        }
    }

    updateSyncStatus(online) {
        const badge = document.getElementById('connection-status');
        if (!badge) return;
        if (online) {
            badge.classList.remove('offline');
            badge.classList.add('online');
            badge.querySelector('.status-text').textContent = 'Sincronizado';
        } else {
            badge.classList.remove('online');
            badge.classList.add('offline');
            badge.querySelector('.status-text').textContent = 'Local';
        }
    }

    setupInstallPrompt() {
        this.deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
        });

        if (this.installBtn) {
            this.installBtn.addEventListener('click', async () => {
                if (this.deferredPrompt) {
                    this.deferredPrompt.prompt();
                    const { outcome } = await this.deferredPrompt.userChoice;
                    this.deferredPrompt = null;
                } else {
                    this.helpModal.style.display = 'flex';
                }
            });
        }
    }

    startSync() {
        if (!this.db) return;
        
        // Base Path para evitar colisiones
        const basePath = 'iliana_track';

        // Sync Materials
        this.db.ref(`${basePath}/materials`).on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                this.materials = Object.values(data);
                if (this.currentView === 'inventory') this.render();
            }
        });

        // Sync Equipment
        this.db.ref(`${basePath}/equipment`).on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                this.equipment = Object.values(data);
                if (this.currentView === 'equipment') this.render();
            }
        });

        // Sync Tips
        this.db.ref(`${basePath}/tips`).on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                this.tips = Object.values(data);
                if (this.currentView === 'technicians') this.render();
            }
        });
    }

    async uploadToFirebase() {
        if (!this.db) return;
        
        const basePath = 'iliana_track';
        
        const materialsData = {};
        this.materials.forEach(m => materialsData[m.partNumber.replace(/[.#$/[\]]/g, '_')] = m);
        await this.db.ref(`${basePath}/materials`).set(materialsData);

        const equipmentData = {};
        this.equipment.forEach(e => equipmentData[e.id] = e);
        await this.db.ref(`${basePath}/equipment`).set(equipmentData);

        const tipsData = {};
        this.tips.forEach(t => tipsData[t.id] = t);
        await this.db.ref(`${basePath}/tips`).set(tipsData);
    }

    showConfigModal() {
        this.configModal.style.display = 'flex';
        document.getElementById('firebase-config-json').value = localStorage.getItem('iliana_firebase_config') || '';
    }

    saveFirebaseConfig() {
        const json = document.getElementById('firebase-config-json').value;
        const msg = document.getElementById('sync-status');
        try {
            JSON.parse(json);
            localStorage.setItem('iliana_firebase_config', json);
            msg.textContent = "¡Configuración guardada! Reiniciando...";
            msg.className = "status-msg success";
            setTimeout(() => location.reload(), 1500);
        } catch (e) {
            msg.textContent = "Error: El JSON no es válido.";
            msg.className = "status-msg error";
        }
    }

    setupScanner() {
        this.html5QrCode = null;
        this.isScannerActive = false;
    }

    async toggleScanner() {
        const reader = document.getElementById('reader');
        if (this.isScannerActive) {
            await this.html5QrCode.stop();
            reader.style.display = 'none';
            this.isScannerActive = false;
        } else {
            reader.style.display = 'block';
            this.html5QrCode = new Html5Qrcode("reader");
            this.isScannerActive = true;
            this.html5QrCode.start(
                { facingMode: "environment" },
                { fps: 10, qrbox: { width: 250, height: 250 } },
                (decodedText) => {
                    if (decodedText.startsWith('ILIANA_DATA:') || decodedText.startsWith('ILIANA_DATA_MULTI:')) {
                        this.importFromQR(decodedText);
                    } else {
                        this.searchInput.value = decodedText;
                        this.render();
                    }
                    this.toggleScanner(); 
                },
                (errorMessage) => { /* ignore */ }
            );
        }
    }

    initTheme() {
        const theme = localStorage.getItem('iliana_theme') || 'light';
        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
            if (this.darkModeBtn) this.darkModeBtn.textContent = '☀️';
        }
    }

    toggleDarkMode() {
        const isDark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('iliana_theme', isDark ? 'dark' : 'light');
        if (this.darkModeBtn) this.darkModeBtn.textContent = isDark ? '☀️' : '🌙';
    }

    initBottomSheet() {
        if (!this.bottomSheet) return;

        let startY = 0;
        let currentY = 0;

        const handleStart = (e) => {
            startY = e.type.includes('mouse') ? e.pageY : e.touches[0].pageY;
        };

        const handleEnd = (e) => {
            currentY = e.type.includes('mouse') ? e.pageY : e.changedTouches[0].pageY;
            const diff = startY - currentY;
            
            if (diff > 50) { // Swipe up
                this.openBottomSheet();
            } else if (diff < -50) { // Swipe down
                this.closeBottomSheet();
            }
        };

        // Tap on handle/sheet also toggles
        this.sheetHandle.addEventListener('click', () => this.toggleBottomSheet());
        
        // Touch events
        this.bottomSheet.addEventListener('touchstart', handleStart);
        this.bottomSheet.addEventListener('touchend', handleEnd);
        
        // Mouse/Desktop support
        this.sheetHandle.addEventListener('mousedown', handleStart);
        this.sheetHandle.addEventListener('mouseup', handleEnd);
    }

    openBottomSheet() {
        this.bottomSheet.classList.add('open');
    }

    closeBottomSheet() {
        this.bottomSheet.classList.remove('open');
    }

    toggleBottomSheet() {
        this.bottomSheet.classList.toggle('open');
    }

    switchView(viewId) {
        this.currentView = viewId;
        this.navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewId);
        });
        document.querySelectorAll('.app-view').forEach(view => {
            view.classList.toggle('active', view.id === `${viewId}-view`);
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        this.closeBottomSheet(); // Always close after selection
        this.render();
    }

    handleCSVImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target.result;
            const lines = text.split(/\r?\n/);
            if (lines.length < 2) return;

            const firstLine = lines[0];
            const delimiter = firstLine.includes(';') ? ';' : ',';
            const headers = firstLine.split(delimiter).map(h => h.trim().replace(/"/g, ''));
            const getIdx = (name) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

            // Determine if it's Inventory, Equipment, or Tips
            const isInventory = getIdx('Part Number') !== -1;
            const isEquipment = getIdx('Nombre') !== -1 || getIdx('Modelo') !== -1;
            const isTips = getIdx('Tecnico') !== -1 || getIdx('Punta') !== -1;

            if (isInventory) {
                const pnIdx = getIdx('Part Number'), descIdx = getIdx('Descripcion'), locIdx = getIdx('Ubicacion'), grnIdx = getIdx('GRN'), qtyIdx = getIdx('Cantidad');
                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(delimiter).map(v => v.trim().replace(/"/g, ''));
                    if (!values[pnIdx]) continue;
                    const pn = values[pnIdx].toUpperCase();
                    let existing = this.materials.find(m => m.partNumber === pn);
                    if (existing) {
                        existing.quantity += parseInt(values[qtyIdx]) || 0;
                        existing.logs.push({ type: 'IMPORT', delta: parseInt(values[qtyIdx]) || 0, date: new Date().toISOString() });
                    } else {
                        this.materials.push({
                            partNumber: pn, description: values[descIdx] || '', location: values[locIdx] || '', grn: values[grnIdx] || '',
                            quantity: parseInt(values[qtyIdx]) || 0, image: '', lastUpdated: new Date().toISOString(),
                            logs: [{ type: 'IMPORT', delta: parseInt(values[qtyIdx]) || 0, date: new Date().toISOString() }]
                        });
                    }
                }
            } else if (isEquipment) {
                const nameIdx = getIdx('Nombre'), modIdx = getIdx('Modelo');
                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(delimiter).map(v => v.trim().replace(/"/g, ''));
                    if (!values[nameIdx]) continue;
                    this.equipment.push({ id: Date.now() + i, name: values[nameIdx], model: values[modIdx] || '', history: [] });
                }
            } else if (isTips) {
                const techIdx = getIdx('Tecnico'), typeIdx = getIdx('Tipo');
                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(delimiter).map(v => v.trim().replace(/"/g, ''));
                    if (!values[techIdx]) continue;
                    this.tips.push({ id: Date.now() + i, technician: values[techIdx], type: values[typeIdx] || '', date: new Date().toISOString(), history: [] });
                }
            }

            await this.save();
            this.render();
            this.importInput.value = '';
            alert("¡Importación completada!");
        };
        reader.readAsText(file);
    }

    exportToCSV() {
        // Export Inventory
        let materialCsv = "Part Number,Descripcion,Ubicacion,GRN,Cantidad,Ultima Actualizacion\n";
        this.materials.forEach(m => {
            materialCsv += `${m.partNumber},"${m.description}",${m.location},${m.grn},${m.quantity},${m.lastUpdated}\n`;
        });
        this.downloadCSV(materialCsv, `inventario_iliana_${new Date().toISOString().split('T')[0]}.csv`);

        // Export Equipment
        if (this.equipment.length > 0) {
            let eqCsv = "ID,Nombre,Modelo,Mantenimientos\n";
            this.equipment.forEach(e => {
                eqCsv += `${e.id},"${e.name}",${e.model},${e.history ? e.history.length : 0}\n`;
            });
            setTimeout(() => this.downloadCSV(eqCsv, `equipos_iliana_${new Date().toISOString().split('T')[0]}.csv`), 500);
        }

        // Export Tips
        if (this.tips.length > 0) {
            let tipsCsv = "ID,Tecnico,Tipo,Reemplazos,Fecha Inicio\n";
            this.tips.forEach(t => {
                tipsCsv += `${t.id},"${t.technician}",${t.type},${t.history ? t.history.length : 0},${t.date}\n`;
            });
            setTimeout(() => this.downloadCSV(tipsCsv, `puntas_iliana_${new Date().toISOString().split('T')[0]}.csv`), 1000);
        }
    }

    downloadCSV(csv, filename) {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
    }

    exportToJSON() {
        const data = {
            inventory: this.materials,
            equipment: this.equipment,
            tips: this.tips,
            version: '1.0',
            exportedAt: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `backup_iliana_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
    }

    importFromJSON(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.inventory) this.materials = data.inventory;
                if (data.equipment) this.equipment = data.equipment;
                if (data.tips) this.tips = data.tips;
                
                await this.save();
                this.render();
                alert("¡Base de datos restaurada correctamente!");
            } catch (err) {
                alert("Error al leer el archivo JSON.");
            }
            document.getElementById('import-json').value = '';
        };
        reader.readAsText(file);
    }

    handleImage(e, stateVar, previewId) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 400;
                const MAX_HEIGHT = 400;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                this[stateVar] = canvas.toDataURL('image/jpeg', 0.7);
                document.getElementById(previewId).style.backgroundImage = `url(${this[stateVar]})`;
                e.target.value = ''; // Clean input
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    showMaterialModal(editPart = null) {
        this.isEditing = !!editPart;
        this.materialModal.style.display = 'flex';
        document.getElementById('modal-title').textContent = this.isEditing ? 'Editar Material' : 'Ingresar Material';
        
        document.getElementById('part-number').value = editPart ? editPart.partNumber : '';
        document.getElementById('part-number').disabled = this.isEditing;
        document.getElementById('description').value = editPart ? editPart.description : '';
        document.getElementById('location').value = editPart ? editPart.location : '';
        document.getElementById('grn').value = editPart ? editPart.grn : '';
        document.getElementById('quantity').value = editPart ? editPart.quantity : '0';
        document.getElementById('quantity').disabled = this.isEditing; 
        document.getElementById('entered-by').value = editPart ? (editPart.enteredBy || '') : '';

        const preview = document.getElementById('image-preview');
        this.currentMaterialImage = editPart ? editPart.image : '';
        preview.style.backgroundImage = this.currentMaterialImage ? `url(${this.currentMaterialImage})` : '';
    }

    showLogModal(partNumber) {
        this.currentPart = this.materials.find(m => m.partNumber === partNumber);
        if (!this.currentPart) return;
        
        document.getElementById('log-part-name').textContent = `${this.currentPart.partNumber} - ${this.currentPart.description}`;
        document.getElementById('update-qty').value = '1';
        
        // Render history list with running balance
        const historyList = document.getElementById('log-history-list');
        let balance = 0;
        const processedLogs = this.currentPart.logs.map(l => {
            balance += l.delta;
            return { ...l, balance };
        }).reverse();

        historyList.innerHTML = processedLogs.map(l => `
            <div class="log-entry ${l.delta > 0 ? 'entrada' : 'consumo'}">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 600;">${new Date(l.date).toLocaleDateString()} ${new Date(l.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    <small>${l.type}</small>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 1rem; font-weight: 800;">${l.delta > 0 ? '+' : ''}${l.delta}</span>
                    <br><small>Saldo: ${l.balance}</small>
                </div>
            </div>
        `).join('');
        
        this.logModal.style.display = 'flex';
    }

    editMaterial() {
        if (!this.currentPart) return;
        const part = this.currentPart;
        this.hideModal('log-modal');
        this.showMaterialModal(part);
    }

    async deleteMaterial() {
        if (!this.currentPart) return;
        this.materials = this.materials.filter(m => m.partNumber !== this.currentPart.partNumber);
        await this.save();
        this.render();
        this.hideModal('log-modal');
    }

    adjustUpdateQty(delta) {
        const input = document.getElementById('update-qty');
        let val = parseInt(input.value) || 0;
        input.value = val + delta;
    }

    async addMaterial() {
        const partNumber = document.getElementById('part-number').value.trim().toUpperCase();
        const description = document.getElementById('description').value.trim();
        const location = document.getElementById('location').value;
        const grn = document.getElementById('grn').value.trim();
        const initialQty = parseInt(document.getElementById('quantity').value) || 0;
        const enteredBy = document.getElementById('entered-by').value.trim();

        if (!partNumber) return; // Silent return if no PN

        const existing = this.materials.find(m => m.partNumber === partNumber);
        
        if (this.isEditing && existing) {
            existing.description = description;
            existing.location = location;
            existing.grn = grn;
            existing.enteredBy = enteredBy;
            existing.image = this.currentMaterialImage || existing.image;
        } else if (existing) {
            existing.description = description;
            existing.location = location;
            existing.grn = grn;
            if (enteredBy && !existing.enteredBy) existing.enteredBy = enteredBy; // Only update if empty to preserve history, or just overwrite it? Better overwrite to track who last registered:
            existing.enteredBy = enteredBy; 
            existing.image = this.currentMaterialImage || existing.image;
            
            if (initialQty !== 0) {
                existing.quantity += initialQty;
                existing.logs.push({
                    type: 'ENTRADA (ADD)',
                    delta: initialQty,
                    date: new Date().toISOString()
                });
            }
        } else {
            const newMaterial = {
                partNumber,
                description,
                location,
                grn,
                enteredBy,
                image: this.currentMaterialImage || '',
                quantity: initialQty,
                lastUpdated: new Date().toISOString(),
                logs: [{
                    type: 'INICIAL',
                    delta: initialQty,
                    date: new Date().toISOString()
                }]
            };
            this.materials.push(newMaterial);
        }

        await this.save();
        this.searchInput.value = ''; 
        this.render();
        this.hideModal('material-modal');
        this.currentMaterialImage = ''; // Clear
    }

    async updateStock() {
        if (!this.currentPart) return;
        const delta = parseInt(document.getElementById('update-qty').value);
        if (isNaN(delta) || delta === 0) return;

        // User requested NO warnings ever, even for negative stock
        this.currentPart.quantity += delta;
        this.currentPart.lastUpdated = new Date().toISOString();
        this.currentPart.logs.push({
            type: delta > 0 ? 'ENTRADA' : 'CONSUMO',
            delta: delta,
            date: new Date().toISOString()
        });

        await this.save();
        this.render();
        this.hideModal('log-modal');
    }

    async save() {
        try {
            await idbSet('iliana_inventory', this.materials);
            await idbSet('iliana_equipment', this.equipment);
            await idbSet('iliana_tips', this.tips);
        } catch (e) {
            console.error("Storage full or IDB error! Cannot save changes.", e);
        }
        if (this.db) {
            await this.uploadToFirebase();
        }
    }

    render() {
        if (this.currentView === 'inventory') {
            this.renderInventory();
        } else if (this.currentView === 'equipment') {
            this.renderEquipment();
        } else if (this.currentView === 'technicians') {
            this.renderTips();
        }
    }

    renderInventory() {
        const query = this.searchInput.value.toLowerCase().trim();
        const filtered = this.materials.filter(m => {
            const pn = m.partNumber.toLowerCase();
            const desc = m.description.toLowerCase();
            const grn = (m.grn || '').toLowerCase();
            return pn.includes(query) || desc.includes(query) || grn.includes(query);
        });

        this.inventoryList.innerHTML = '';
        let lowStockCount = 0;

        if (filtered.length === 0) {
            this.inventoryList.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">🔍</div>
                    <p>No se encontraron materiales.</p>
                </div>
            `;
        }

        filtered.forEach(m => {
            const isLow = m.quantity < 5;
            if (isLow) lowStockCount++;

            const card = document.createElement('div');
            card.className = 'material-card';
            card.innerHTML = `
                <div style="display: flex; align-items: center;">
                    ${m.image ? `<div class="material-img" style="background-image: url(${m.image})"></div>` : ''}
                    <div class="material-info">
                        <h3>${m.partNumber}</h3>
                        <p>${m.description}</p>
                        <span class="location-badge">${m.location || 'Bin'}</span>
                        ${m.grn ? `<span class="location-badge" style="background: #fdf2f2; color: #991b1b;">GRN: ${m.grn}</span>` : ''}
                        ${m.enteredBy ? `<p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.4rem;">👤 ${m.enteredBy}</p>` : ''}
                    </div>
                </div>
                <div class="material-stock">
                    <span class="qty-badge">${m.quantity}</span>
                    <span class="status-label ${isLow ? 'low' : 'ok'}">${isLow ? 'Stock Bajo' : 'Disponible'}</span>
                </div>
            `;
            card.addEventListener('click', () => this.showLogModal(m.partNumber));
            this.inventoryList.appendChild(card);
        });

        document.getElementById('total-parts').textContent = this.materials.length;
        document.getElementById('low-stock-count').textContent = lowStockCount;
    }

    renderEquipment() {
        const list = document.getElementById('equipment-list');
        list.innerHTML = this.equipment.length === 0 ? '<p style="text-align:center; padding: 2rem; color: #666;">No hay equipos registrados.</p>' : '';
        
        this.equipment.forEach(e => {
            const card = document.createElement('div');
            card.className = 'material-card';
            const lastMaint = e.history && e.history.length > 0 ? new Date(e.history[e.history.length-1].date).toLocaleDateString() : 'N/A';
            
            card.innerHTML = `
                <div style="display: flex; align-items: center; flex: 1;" onclick="app.showHistory('equipment', ${e.id})">
                    ${e.image ? `<div class="material-img" style="background-image: url(${e.image})"></div>` : ''}
                    <div class="material-info">
                        <h3>${e.name}</h3>
                        <p>${e.model || 'S/N'}</p>
                        <small>Último Maint: <strong>${lastMaint}</strong></small>
                        ${e.enteredBy ? `<p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.4rem;">👤 ${e.enteredBy}</p>` : ''}
                    </div>
                </div>
                <div class="material-stock">
                    <button class="btn-primary-small" style="margin-bottom: 0.5rem; background: var(--accent-green);" onclick="app.showMaintenanceModal(${e.id})">🔧 Log</button>
                    <br>
                    <button class="btn-icon-subtle" onclick="app.deleteEquipment(${e.id})">🗑️</button>
                </div>
            `;
            list.appendChild(card);
        });
    }

    renderTips() {
        const list = document.getElementById('tips-list');
        list.innerHTML = this.tips.length === 0 ? '<p style="text-align:center; padding: 2rem; color: #666;">No hay puntas asignadas.</p>' : '';
        
        this.tips.forEach(t => {
            const history = t.history || [];
            const replacements = history.filter(h => h.type === 'REEMPLAZO').length;
            
            let freqText = 'Cálculo pendiente...';
            if (replacements > 0) {
                const start = new Date(t.date); 
                const end = new Date();
                const days = Math.floor((end - start) / (1000 * 60 * 60 * 24));
                const totalTips = replacements + 1;
                const avg = (days / totalTips).toFixed(1);
                freqText = `${avg} días / punta`;
            }

            const card = document.createElement('div');
            card.className = 'material-card';
            card.innerHTML = `
                <div style="display: flex; align-items: center; flex: 1;" onclick="app.showHistory('tip', ${t.id})">
                    ${t.image ? `<div class="material-img" style="background-image: url(${t.image})"></div>` : ''}
                    <div class="material-info">
                        <h3>${t.technician}</h3>
                        <p>Punta: ${t.type}</p>
                        <small>Frecuencia: <strong>${freqText}</strong></small>
                        ${t.enteredBy ? `<p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.4rem;">👤 ${t.enteredBy}</p>` : ''}
                    </div>
                </div>
                <div class="material-stock">
                    <button class="btn-primary-small" style="background: var(--accent-orange);" onclick="app.replaceTip(${t.id})">🔄 Reemplazar</button>
                </div>
            `;
            list.appendChild(card);
        });
    }

    addEquipment() {
        const name = document.getElementById('eq-name').value.trim();
        const model = document.getElementById('eq-model').value.trim();
        const quantity = parseInt(document.getElementById('eq-quantity').value) || 1;
        const enteredBy = document.getElementById('eq-entered-by').value.trim();
        if (!name) return;
        this.equipment.push({ 
            id: Date.now(), 
            name, 
            model, 
            enteredBy,
            quantity, 
            image: this.currentEquipmentImage || '' 
        });
        this.save(); this.render(); this.hideModal('equipment-modal');
        document.getElementById('eq-name').value = ''; 
        document.getElementById('eq-model').value = '';
        document.getElementById('eq-entered-by').value = '';
        document.getElementById('eq-image-preview').style.backgroundImage = '';
        this.currentEquipmentImage = '';
    }

    deleteEquipment(id) {
        this.equipment = this.equipment.filter(e => e.id !== id);
        this.save(); this.render();
    }

    addTip() {
        const technician = document.getElementById('tip-tech').value.trim();
        const type = document.getElementById('tip-type').value.trim();
        const enteredBy = document.getElementById('tip-entered-by').value.trim();
        if (!technician || !type) return;
        this.tips.push({ 
            id: Date.now(), 
            technician, 
            type, 
            enteredBy,
            date: new Date().toISOString(), 
            image: this.currentTipImage || '', 
            history: [] 
        });
        this.save(); this.render(); this.hideModal('tip-modal');
        document.getElementById('tip-tech').value = ''; 
        document.getElementById('tip-type').value = '';
        document.getElementById('tip-entered-by').value = '';
        document.getElementById('tip-image-preview').style.backgroundImage = '';
        this.currentTipImage = '';
    }

    replaceTip(id) {
        const tip = this.tips.find(t => t.id === id);
        if (tip) {
            if (!tip.history) tip.history = [];
            tip.history.push({ 
                date: new Date().toISOString(), 
                type: 'REEMPLAZO',
                note: 'Cambio de punta estándar'
            });
            this.save(); this.render();
        }
    }

    showMaintenanceModal(id) {
        this.currentEquipmentId = id;
        const eq = this.equipment.find(e => e.id === id);
        if (!eq) return;
        
        document.getElementById('maint-eq-name').textContent = `${eq.name} (${eq.model})`;
        document.getElementById('maint-notes').value = '';
        this.showModal('maintenance-modal');
    }

    async saveMaintenance() {
        const notes = document.getElementById('maint-notes').value.trim();
        const type = document.getElementById('maint-type').value;
        const eq = this.equipment.find(e => e.id === this.currentEquipmentId);
        
        if (eq) {
            if (!eq.history) eq.history = [];
            eq.history.push({
                date: new Date().toISOString(),
                type,
                notes
            });
            await this.save();
            this.render();
            this.hideModal('maintenance-modal');
        }
    }

    showHistory(type, id) {
        const historyList = document.getElementById('history-list-content');
        const title = document.getElementById('history-modal-title');
        const subtitle = document.getElementById('history-subtitle');
        let history = [];
        let name = '';

        if (type === 'equipment') {
            const eq = this.equipment.find(e => e.id === id);
            if (!eq) return;
            name = eq.name;
            title.textContent = 'Historial de Mantenimiento';
            history = (eq.history || []).slice().reverse();
        } else if (type === 'tip') {
            const tip = this.tips.find(t => t.id === id);
            if (!tip) return;
            name = tip.technician;
            title.textContent = 'Historial de Reemplazos';
            history = (tip.history || []).slice().reverse();
        }

        subtitle.textContent = name;
        
        if (history.length === 0) {
            historyList.innerHTML = '<p style="text-align:center; padding: 2rem; color: #666;">Sin registros aún.</p>';
        } else {
            historyList.innerHTML = history.map(h => `
                <div class="log-entry">
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-weight: 600;">${new Date(h.date).toLocaleDateString()}</span>
                        <small>${h.type}</small>
                        ${h.notes ? `<p style="margin-top: 0.2rem; font-style: italic;">"${h.notes}"</p>` : ''}
                    </div>
                </div>
            `).join('');
        }

        this.showModal('history-modal');
    }

    showModal(id) {
        document.getElementById(id).style.display = 'flex';
    }

    shareDataViaQR() {
        const MAX_QR_DATA_LENGTH = 1200; // safe limit to prevent URI length issues
        
        let chunks = [];
        let currentChunk = { i: [], e: [], t: [] };
        let currentLength = 15;
        
        const tryPushChunk = (len) => {
            if (currentLength + len > MAX_QR_DATA_LENGTH) {
                if (currentChunk.i.length > 0 || currentChunk.e.length > 0 || currentChunk.t.length > 0) {
                    chunks.push(currentChunk);
                }
                currentChunk = { i: [], e: [], t: [] };
                currentLength = 15;
            }
        };

        this.materials.forEach(m => {
            const row = { p: m.partNumber, q: m.quantity, d: m.description, l: m.location, g: m.grn, u: m.enteredBy };
            const len = JSON.stringify(row).length + 3;
            tryPushChunk(len);
            currentChunk.i.push(row);
            currentLength += len;
        });

        this.equipment.forEach(e => {
            const row = { n: e.name, m: e.model, u: e.enteredBy };
            const len = JSON.stringify(row).length + 3;
            tryPushChunk(len);
            currentChunk.e.push(row);
            currentLength += len;
        });

        this.tips.forEach(t => {
            const row = { n: t.technician, t: t.type, u: t.enteredBy };
            const len = JSON.stringify(row).length + 3;
            tryPushChunk(len);
            currentChunk.t.push(row);
            currentLength += len;
        });

        if (currentChunk.i.length > 0 || currentChunk.e.length > 0 || currentChunk.t.length > 0) {
             chunks.push(currentChunk);
        }

        if (chunks.length === 0) {
             alert("No hay datos para compartir.");
             return;
        }

        this.qrChunks = chunks.map((c, idx) => 'ILIANA_DATA_MULTI:' + (idx + 1) + ':' + chunks.length + ':' + JSON.stringify(c));
        this.currentQrIndex = 0;
        this.renderQrShareModal();
    }

    renderQrShareModal() {
        const payload = this.qrChunks[this.currentQrIndex];
        const qrSize = Math.min(window.innerWidth - 100, 300);
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(payload)}`;
        
        const modal = document.getElementById('qr-share-modal');
        const img = document.getElementById('qr-share-img');
        const progress = document.getElementById('qr-share-progress');
        const prevBtn = document.getElementById('qr-prev-btn');
        const nextBtn = document.getElementById('qr-next-btn');
        const navActions = document.getElementById('qr-nav-actions');
        
        if (this.qrChunks.length > 1) {
            progress.style.display = 'block';
            navActions.style.display = 'flex';
            progress.textContent = `Código QR ${this.currentQrIndex + 1} de ${this.qrChunks.length}`;
        } else {
            progress.style.display = 'none';
            navActions.style.display = 'none';
        }
        
        img.onerror = () => {
             alert("Error al generar el QR. Por favor usa 'Restaurar/Descargar JSON' porque los datos son demasiado pesados.");
        };
        img.src = qrUrl;

        if (prevBtn) {
            prevBtn.style.opacity = this.currentQrIndex === 0 ? '0.5' : '1';
            prevBtn.onclick = () => {
                if (this.currentQrIndex > 0) {
                    this.currentQrIndex--;
                    this.renderQrShareModal();
                }
            };
        }
        if (nextBtn) {
            nextBtn.style.opacity = this.currentQrIndex === this.qrChunks.length - 1 ? '0.5' : '1';
            nextBtn.onclick = () => {
                if (this.currentQrIndex < this.qrChunks.length - 1) {
                    this.currentQrIndex++;
                    this.renderQrShareModal();
                }
            };
        }

        modal.style.display = 'flex';
    }

    async importFromQR(dataString) {
        try {
            let json = '';
            let isMulti = false;
            let current = 1;
            let total = 1;

            if (dataString.startsWith('ILIANA_DATA_MULTI:')) {
                const parts = dataString.split(':');
                current = parseInt(parts[1]);
                total = parseInt(parts[2]);
                json = parts.slice(3).join(':');
                isMulti = true;
            } else if (dataString.startsWith('ILIANA_DATA:')) {
                json = dataString.replace('ILIANA_DATA:', '');
            } else {
                return;
            }

            const data = JSON.parse(json);
            
            if (data.i) {
                data.i.forEach(m => {
                    let existing = this.materials.find(ex => ex.partNumber === m.p);
                    if (existing) {
                        // "dejalo igual no lo incremente o disminuya" - keep existing quantity untouched
                        // We only update additional info if missing
                        if (m.d && !existing.description) existing.description = m.d;
                        if (m.l && !existing.location) existing.location = m.l;
                        if (m.g && !existing.grn) existing.grn = m.g;
                        if (m.u && !existing.enteredBy) existing.enteredBy = m.u;
                    } else {
                        this.materials.push({ 
                            partNumber: m.p, 
                            description: m.d || '', 
                            location: m.l || '',
                            grn: m.g || '',
                            enteredBy: m.u || '',
                            quantity: m.q || 0, 
                            image: '',
                            logs: [{ type: 'IMPORT QR', delta: m.q || 0, date: new Date().toISOString() }], 
                            lastUpdated: new Date().toISOString() 
                        });
                    }
                });
            }
            if (data.e) {
                data.e.forEach(e => {
                    let existing = this.equipment.find(ex => ex.name === e.n && ex.model === e.m);
                    if (!existing) {
                        this.equipment.push({ id: Date.now() + Math.random(), name: e.n, model: e.m, image: '', enteredBy: e.u || '', history: [] });
                    } else if (e.u && !existing.enteredBy) {
                        existing.enteredBy = e.u;
                    }
                });
            }
            if (data.t) {
                data.t.forEach(t => {
                    let existing = this.tips.find(ex => ex.technician === t.n && ex.type === t.t);
                    if (!existing) {
                        this.tips.push({ id: Date.now() + Math.random(), technician: t.n, type: t.t, image: '', enteredBy: t.u || '', date: new Date().toISOString(), history: [] });
                    } else if (t.u && !existing.enteredBy) {
                        existing.enteredBy = t.u;
                    }
                });
            }
            
            await this.save();
            this.render();
            
            if (isMulti) {
                if (current < total) {
                    alert(`¡Parte ${current} de ${total} escaneada y guardada!\nPor favor, ahora escanea el siguiente QR.`);
                } else {
                    alert(`¡Última parte (${current} de ${total}) escaneada! Toda la información ha sido agregada exitosamente.`);
                }
            } else {
                alert("¡Información compartida agregada con éxito!");
            }
        } catch (e) {
            alert("Error al importar datos del QR. Asegúrate de que el código es válido.");
        }
    }

    hideModal(id) {
        document.getElementById(id).style.display = 'none';
        this.currentPart = null;
        this.isEditing = false;
    }
}

const app = new PCBAMaterialManager();
