import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, doc, setDoc, getDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// SERVICE WORKER REGISTRATION
if ('serviceWorker' in navigator) {
    if (window.location.protocol.startsWith('http')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(err => {
                console.warn('Service worker registration failed:', err);
            });
        });
    }
}

// CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyCoi-ZuQQvQjhjOmMhxXarB0C4gA0tn68Q",
    authDomain: "splitsync-9a3d7.firebaseapp.com",
    projectId: "splitsync-9a3d7",
    storageBucket: "splitsync-9a3d7.firebasestorage.app",
    messagingSenderId: "676236175990",
    appId: "1:676236175990:web:af9848bbe4733c794dcd57"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// STATE
let currentRoom = localStorage.getItem('splitsync_room_id');
let currentMode = 'burn'; 
let unsubscribe = null;
let allTransactions = [];
let configData = {
    members: ['Me'],
    categories: [
        {name: 'Food', amount: 0, isBill: false},
        {name: 'Transport', amount: 0, isBill: false}
    ],
    budget: 0,
    history: {} 
};
let confirmCallback = null;
let statsView = 'month';
let viewDate = new Date(); 
let editingCategoryName = null;

// EXPORTS
window.openAddModal = openAddModal;
window.openSettings = openSettings;
window.openStats = openStats;
window.closeModal = closeModal;
window.setMode = setMode;
window.saveTransaction = saveTransaction;
window.attemptLogin = attemptLogin;
window.logout = logout;
window.addItem = addItem;
window.removeItem = removeItem;
window.closeConfirm = closeConfirm;
window.setStatsView = setStatsView;
window.changeStatsPeriod = changeStatsPeriod;
window.deleteTxn = deleteTxn;
window.editTxn = editTxn;
window.saveConfig = saveConfig;
window.editCategory = editCategory;
window.toggleBill = toggleBill;

// INIT
checkAuth();

document.getElementById('login-code').addEventListener("keypress", (e) => {
    if (e.key === "Enter") { e.preventDefault(); attemptLogin(); }
});

document.getElementById('add-sheet-content').addEventListener("keypress", (e) => {
    if (e.key === "Enter" && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault(); 
        saveTransaction();
    }
});

document.getElementById('new-cat-amount').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addItem('categories');
});
document.getElementById('new-cat-name').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('new-cat-amount').focus();
});

// --- UI UTILS ---
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showConfirm(title, msg, onYes) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    document.getElementById('confirm-modal-overlay').classList.add('open');
    confirmCallback = onYes;
}

function closeConfirm(isYes) {
    document.getElementById('confirm-modal-overlay').classList.remove('open');
    if (isYes && confirmCallback) confirmCallback();
    confirmCallback = null;
}

// --- AUTH ---
function checkAuth() {
    if (currentRoom) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('room-display').textContent = currentRoom;
        document.getElementById('settings-room-id').textContent = currentRoom;
        loadConfig(); 
        subscribeToData();
    } else {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('login-code').focus();
    }
}

function attemptLogin() {
    const code = document.getElementById('login-code').value.trim();
    if (code.length > 0) {
        currentRoom = code;
        localStorage.setItem('splitsync_room_id', currentRoom);
        checkAuth();
        showToast(`Welcome to Room ${code}`);
    } else {
        showToast("Please enter a code", "error");
    }
}

function logout() {
    showConfirm("Exit Group", "You will need the code to enter again.", () => {
        localStorage.removeItem('splitsync_room_id');
        currentRoom = null;
        if (unsubscribe) unsubscribe();
        document.getElementById('login-code').value = "";
        checkAuth();
    });
}

// --- CONFIG & SETTINGS ---
async function loadConfig() {
    const docRef = doc(db, "rooms", currentRoom, "config", "main");
    try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            let data = docSnap.data();
            if (data.categories && data.categories.length > 0 && typeof data.categories[0] === 'string') {
                data.categories = data.categories.map(c => ({ name: c, amount: 0, isBill: false }));
                await updateDoc(docRef, { categories: data.categories });
            }
            configData = { ...configData, ...data };
            if (!configData.history) configData.history = {};
        } else {
            await setDoc(docRef, configData);
        }
        calculateTotalBudget();
    } catch (e) { console.log("Config load error:", e); }
}

function calculateTotalBudget() {
    let total = 0;
    configData.categories.forEach(c => total += (c.amount || 0));
    configData.budget = total;
    document.getElementById('inp-budget-display').value = `₱${total.toLocaleString()}`;
}

async function saveConfig() {
    calculateTotalBudget();
    
    const now = new Date();
    const historyKey = `${now.getFullYear()}-${now.getMonth()}`;
    
    if (!configData.history) configData.history = {};
    
    configData.history[historyKey] = {
        budget: configData.budget,
        members: [...configData.members],
        categories: JSON.parse(JSON.stringify(configData.categories))
    };

    const docRef = doc(db, "rooms", currentRoom, "config", "main");
    try {
        await setDoc(docRef, configData);
        showToast("Settings saved");
    } catch (e) { showToast("Error saving", "error"); }
}

function openSettings() {
    editingCategoryName = null;
    document.getElementById('btn-add-cat').textContent = "Add";
    renderSettingsLists();
    calculateTotalBudget();
    document.getElementById('settings-modal-overlay').classList.add('open');
}

function renderSettingsLists() {
    const mList = document.getElementById('members-list');
    mList.innerHTML = configData.members.map(m => 
        `<div class="chip">${m} <span class="del" onclick="removeItem('members', '${m}')">&times;</span></div>`
    ).join('');

    const cList = document.getElementById('categories-list');
    
    cList.innerHTML = configData.categories.map(c => {
        const isChecked = c.isBill ? 'checked' : '';
        const billStatus = c.isBill ? 'Bill' : 'Optional';
        return `
        <div class="chip" onclick="editCategory('${c.name}')">
            <span style="flex:1">
                ${c.name} 
                <span style="color:var(--text-muted); font-weight:400">(₱${c.amount.toLocaleString()})</span>
            </span>
            <div style="display:flex; align-items:center; gap:10px;">
                <label style="font-size:10px; color:var(--text-muted); display:flex; align-items:center; gap:4px; cursor:pointer" onclick="event.stopPropagation()">
                    <input type="checkbox" onchange="toggleBill('${c.name}')" ${isChecked}> ${billStatus}
                </label>
                <span class="del" onclick="event.stopPropagation(); removeItem('categories', '${c.name}')">&times;</span>
            </div>
        </div>`;
    }).join('');
}

function toggleBill(name) {
    const cat = configData.categories.find(c => c.name === name);
    if (cat) {
        cat.isBill = !cat.isBill;
        saveConfig();
        renderSettingsLists();
    }
}

function editCategory(name) {
    const cat = configData.categories.find(c => c.name === name);
    if (cat) {
        document.getElementById('new-cat-name').value = cat.name;
        document.getElementById('new-cat-amount').value = cat.amount;
        editingCategoryName = name;
        document.getElementById('btn-add-cat').textContent = "Update";
        document.getElementById('new-cat-name').focus();
    }
}

function addItem(type) {
    if (type === 'members') {
        const input = document.getElementById('new-member');
        const val = input.value.trim();
        if (val && !configData.members.includes(val)) {
            configData.members.push(val);
            saveConfig();
            input.value = '';
            renderSettingsLists();
        }
    } else {
        const nameInput = document.getElementById('new-cat-name');
        const amtInput = document.getElementById('new-cat-amount');
        const name = nameInput.value.trim();
        const amt = parseFloat(amtInput.value) || 0;
        
        if (name) {
            if (editingCategoryName) {
                const idx = configData.categories.findIndex(c => c.name === editingCategoryName);
                if (idx !== -1) {
                    configData.categories[idx] = { ...configData.categories[idx], name: name, amount: amt };
                    saveConfig();
                }
                editingCategoryName = null;
                document.getElementById('btn-add-cat').textContent = "Add";
            } else {
                if (!configData.categories.find(c => c.name === name)) {
                    configData.categories.push({ name: name, amount: amt, isBill: false });
                    saveConfig();
                } else {
                    showToast("Category exists", "error");
                }
            }
            nameInput.value = '';
            amtInput.value = '';
            nameInput.focus();
            renderSettingsLists(); 
        }
    }
}

function removeItem(type, val) {
    showConfirm("Remove Item", `Delete "${val}"?`, () => {
        if (type === 'members') {
            configData[type] = configData[type].filter(item => item !== val);
        } else {
            configData[type] = configData[type].filter(item => item.name !== val);
        }
        saveConfig();
        renderSettingsLists(); 
    });
}

// --- TRANSACTIONS ---
function subscribeToData() {
    if (unsubscribe) unsubscribe();
    document.getElementById('transaction-list').innerHTML = '<div class="loading-spinner">Syncing...</div>';

    const q = query(collection(db, "rooms", currentRoom, "transactions"), orderBy("timestamp", "desc"));
    unsubscribe = onSnapshot(q, (snapshot) => {
        allTransactions = [];
        snapshot.forEach((doc) => allTransactions.push({ id: doc.id, ...doc.data() }));
        renderList(allTransactions);
    }, (error) => {
        document.getElementById('transaction-list').innerHTML = '<div class="empty-state" style="color:var(--danger)">Connection Error.</div>';
    });
}

async function saveTransaction() {
    const amountVal = parseFloat(document.getElementById('inp-amount').value);
    
    if (isNaN(amountVal)) { showToast("Invalid Amount", "error"); return; }
    if (currentMode === 'burn' && amountVal <= 0) { showToast("Expense must be > 0", "error"); return; }
    if (currentMode === 'fuel' && amountVal === 0) { showToast("Amount cannot be 0", "error"); return; }

    const btnSave = document.getElementById('btn-save');
    const editId = document.getElementById('edit-id').value;
    btnSave.classList.add('btn-disabled');
    btnSave.textContent = "Saving...";

    try {
        const descVal = document.getElementById('inp-desc').value.trim();
        const userVal = document.getElementById('inp-user').value;
        const collectionRef = collection(db, "rooms", currentRoom, "transactions");
        const serverTime = serverTimestamp();
        
        const rawDate = document.getElementById('inp-date').value; 
        const dateObj = new Date(rawDate);
        const userTimezoneOffset = dateObj.getTimezoneOffset() * 60000;
        const adjustedDate = new Date(dateObj.getTime() + userTimezoneOffset);
        const dateStr = adjustedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        let txnData = {};

        if (currentMode === 'fuel') {
            txnData = {
                type: 'fuel',
                amount: amountVal,
                desc: descVal || 'Contribution',
                category: 'Contribution', 
                user: userVal,
                timestamp: serverTime, 
                dateString: dateStr,
                txnDate: rawDate 
            };
        } else {
            const catVal = document.getElementById('inp-cat').value;
            txnData = {
                type: 'burn',
                amount: amountVal,
                desc: descVal || 'Expense',
                category: catVal,
                user: userVal,
                timestamp: serverTime,
                dateString: dateStr,
                txnDate: rawDate 
            };
        }

        if (editId) {
            delete txnData.timestamp; 
            await updateDoc(doc(db, "rooms", currentRoom, "transactions", editId), txnData);
            showToast("Updated");
        } else {
            await addDoc(collectionRef, txnData);
            if (currentMode === 'burn' && userVal !== 'Pool') {
                 await addDoc(collectionRef, {
                    type: 'fuel',
                    amount: amountVal,
                    desc: `Covered: ${descVal || 'Expense'}`,
                    category: 'Contribution',
                    user: userVal,
                    timestamp: serverTime,
                    dateString: dateStr,
                    txnDate: rawDate
                });
                showToast("Saved + Credit Added");
            } else {
                showToast("Saved");
            }
        }
        closeModal('add');
    } catch (e) {
        console.error(e);
        showToast("Error saving", "error");
    } finally {
        btnSave.classList.remove('btn-disabled');
        document.getElementById('edit-id').value = "";
        setMode(currentMode, false);
    }
}

// --- DASHBOARD ---
function openStats() {
    viewDate = new Date(); 
    setStatsView('month');
    document.getElementById('stats-modal-overlay').classList.add('open');
}

function setStatsView(view) {
    statsView = view;
    document.getElementById('tab-month').className = `toggle-btn ${view==='month' ? 'active' : ''}`;
    document.getElementById('tab-year').className = `toggle-btn ${view==='year' ? 'active' : ''}`;
    renderDashboard();
}

function changeStatsPeriod(offset) {
    if (statsView === 'month') {
        viewDate.setMonth(viewDate.getMonth() + offset);
    } else {
        viewDate.setFullYear(viewDate.getFullYear() + offset);
    }
    renderDashboard();
}

function renderDashboard() {
    const container = document.getElementById('dash-content');
    const targetMonth = viewDate.getMonth();
    const targetYear = viewDate.getFullYear();

    const displayEl = document.getElementById('period-display');
    if (statsView === 'month') {
        displayEl.textContent = viewDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } else {
        displayEl.textContent = targetYear;
    }

    // --- 1. HISTORY CARRYOVER ---
    const memberCarryover = {}; 
    configData.members.forEach(m => memberCarryover[m] = 0);

    let earliestDate = new Date();
    let hasHistory = false;
    
    allTransactions.forEach(t => {
        let d = t.txnDate ? new Date(t.txnDate) : (t.timestamp ? t.timestamp.toDate() : new Date());
        if(t.txnDate) {
             const parts = t.txnDate.split('-');
             d = new Date(parts[0], parts[1]-1, parts[2]); 
        }
        if (d < earliestDate) earliestDate = d;
        hasHistory = true;
    });

    if (hasHistory) {
        let iterDate = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1);
        const viewStart = new Date(targetYear, statsView === 'month' ? targetMonth : 0, 1);

        while (iterDate < viewStart) {
            const iYear = iterDate.getFullYear();
            const iMonth = iterDate.getMonth();
            const historyKey = `${iYear}-${iMonth}`;
            const monthConfig = (configData.history && configData.history[historyKey]) 
                                ? configData.history[historyKey] 
                                : configData;

            let monthBurn = 0;
            const tempCatStats = {}; 

            if(monthConfig.categories) {
                monthConfig.categories.forEach(c => tempCatStats[c.name] = 0);
            }

            allTransactions.forEach(t => {
                let d = t.txnDate ? new Date(t.txnDate) : (t.timestamp ? t.timestamp.toDate() : new Date());
                if(t.txnDate) { 
                    const parts = t.txnDate.split('-');
                    d = new Date(parts[0], parts[1]-1, parts[2]); 
                }

                if (d.getFullYear() === iYear && d.getMonth() === iMonth) {
                    if (t.type === 'burn') {
                        monthBurn += t.amount;
                        if(tempCatStats[t.category] !== undefined) tempCatStats[t.category] += t.amount;
                    } else if (t.type === 'fuel') {
                        if (memberCarryover[t.user] !== undefined) {
                            memberCarryover[t.user] += t.amount; 
                        }
                    }
                }
            });

            // PENDING BILLS LOGIC (HISTORY)
            let pendingBills = 0;
            if(monthConfig.categories) {
                monthConfig.categories.forEach(c => {
                    if(c.isBill) {
                        const spent = tempCatStats[c.name] || 0;
                        // UPDATED: Only consider pending if NO payment made (spent === 0)
                        if(spent === 0) {
                            pendingBills += (c.amount || 0);
                        }
                    }
                });
            }

            const effectiveBudget = Math.max(monthConfig.budget || 0, monthBurn + pendingBills);
            const memberCount = monthConfig.members ? monthConfig.members.length : 1;
            const targetPerPerson = effectiveBudget / memberCount;

            if (monthConfig.members) {
                monthConfig.members.forEach(m => {
                    if (memberCarryover[m] !== undefined) {
                        memberCarryover[m] -= targetPerPerson;
                    }
                });
            }
            iterDate.setMonth(iterDate.getMonth() + 1);
        }
    }

    // --- 2. CURRENT VIEW DATA ---
    const filtered = allTransactions.filter(t => {
        let tDate = new Date();
        if (t.txnDate) {
            const parts = t.txnDate.split('-');
            tDate = new Date(parts[0], parts[1]-1, parts[2]); 
        } else if (t.timestamp) {
            tDate = t.timestamp.toDate(); 
        }

        if (statsView === 'month') {
            return tDate.getMonth() === targetMonth && tDate.getFullYear() === targetYear;
        } else {
            return tDate.getFullYear() === targetYear;
        }
    });

    const viewKey = `${targetYear}-${targetMonth}`;
    const viewConfig = (configData.history && configData.history[viewKey]) 
                       ? configData.history[viewKey] 
                       : configData;

    let totalBurn = 0;
    const memberStats = {}; 
    const categoryStats = {};

    const viewMembers = viewConfig.members || ['Me'];
    const viewCategories = viewConfig.categories || [];

    viewMembers.forEach(m => memberStats[m] = {fuel: 0});
    viewCategories.forEach(c => categoryStats[c.name] = {spent: 0, budget: c.amount || 0});

    filtered.forEach(t => {
        if (t.type === 'fuel') {
            if (memberStats[t.user]) {
                memberStats[t.user].fuel += t.amount;
            }
        } else {
            totalBurn += t.amount;
            if (!categoryStats[t.category]) categoryStats[t.category] = {spent: 0, budget: 0}; 
            categoryStats[t.category].spent += t.amount;
        }
    });

    // PENDING BILLS LOGIC (CURRENT)
    let totalPendingBills = 0;
    viewCategories.forEach(c => {
        if(c.isBill) {
            const stats = categoryStats[c.name];
            const spent = stats ? stats.spent : 0;
            const budget = c.amount || 0;
            
            // UPDATED: Only add full budget if nothing has been spent yet.
            if(spent === 0) {
                totalPendingBills += budget;
            }
        }
    });

    const setBudget = viewConfig.budget || 0;
    const effectiveViewBudget = Math.max(setBudget, totalBurn + totalPendingBills);
    
    const viewMemberCount = viewMembers.length || 1;
    const baseTarget = effectiveViewBudget / viewMemberCount;

    let html = `
        <div class="dash-section" style="margin-top:0">
            <h4>Overview</h4>
            <div class="stat-row">
                <div class="stat-card">
                    <div class="stat-label">Total Target</div>
                    <div class="stat-value" style="color:var(--text)">
                        ₱${effectiveViewBudget.toLocaleString()}
                        ${effectiveViewBudget > setBudget ? '<span style="font-size:10px; display:block; color:var(--warning)">(Over Limit)</span>' : ''}
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Spent + Pending Bills</div>
                    <div class="stat-value burn">
                        ₱${(totalBurn + totalPendingBills).toLocaleString()}
                        ${totalPendingBills > 0 ? `<span style="font-size:10px; display:block; color:var(--text-muted)">Inc. ₱${totalPendingBills.toLocaleString()} unpaid bills</span>` : ''}
                    </div>
                </div>
            </div>
        </div>

        <div class="dash-section">
            <h4>Member Breakdown</h4>
            <table class="dash-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Target</th>
                        <th>Paid</th>
                        <th>To Give</th>
                    </tr>
                </thead>
                <tbody>
                    ${viewMembers.map((name) => {
                        const stats = memberStats[name] || {fuel:0};
                        const carry = memberCarryover[name] || 0;
                        const adjustedTarget = baseTarget - carry;
                        const paid = stats.fuel;
                        const toGive = adjustedTarget - paid;
                        const targetClass = carry > 0 ? 'pos' : (carry < 0 ? 'warn' : '');
                        
                        let toGiveHtml = '';
                        if (toGive > 0) {
                            toGiveHtml = `<span class="neg">-₱${toGive.toLocaleString()}</span>`;
                        } else {
                            toGiveHtml = `<span class="pos">₱${Math.abs(toGive).toLocaleString()}</span>`;
                        }

                        return `
                            <tr>
                                <td>${name}</td>
                                <td class="money ${targetClass}">₱${adjustedTarget.toLocaleString(undefined, {maximumFractionDigits:0})}</td>
                                <td class="money">₱${paid.toLocaleString(undefined, {maximumFractionDigits:0})}</td>
                                <td class="money">${toGiveHtml}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        <div class="dash-section">
            <h4>Category Performance</h4>
             <table class="dash-table">
                <thead>
                    <tr>
                        <th>Category</th>
                        <th>Budget</th>
                        <th>Spent</th>
                        <th>Diff</th>
                    </tr>
                </thead>
                <tbody>
                    ${viewCategories.map(c => {
                        const stats = categoryStats[c.name] || {spent:0};
                        const diff = (c.amount || 0) - stats.spent;
                        const diffClass = diff >= 0 ? 'pos' : 'neg';
                        const isBill = c.isBill;
                        
                        let rowStyle = '';
                        if (stats.spent > (c.amount || 0)) {
                            rowStyle = 'background-color: var(--danger-light)'; 
                        } else if (stats.spent > 0 && stats.spent < (c.amount || 0)) {
                            rowStyle = 'background-color: var(--success-light)';
                        }
                        
                        // Highlight pending bills that are 0 spent
                        if (isBill && stats.spent === 0 && (c.amount||0) > 0) {
                             rowStyle = 'background-color: #FFF7ED;'; 
                        }

                        return `
                            <tr style="${rowStyle}">
                                <td>
                                    ${c.name}
                                    ${isBill ? '<span style="font-size:10px; color:var(--text-muted); display:block;">(Bill)</span>' : ''}
                                </td>
                                <td class="money">₱${(c.amount||0).toLocaleString()}</td>
                                <td class="money">₱${stats.spent.toLocaleString()}</td>
                                <td class="money ${diffClass}">₱${diff.toLocaleString()}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
    container.innerHTML = html;
}

// --- UI & SWIPE ---
function setMode(mode, locked = false) {
    currentMode = mode;
    const container = document.getElementById('mode-toggle');
    if (locked) container.classList.add('locked');
    else container.classList.remove('locked');

    document.getElementById('tab-burn').className = `toggle-btn ${mode === 'burn' ? 'active burn' : ''}`;
    document.getElementById('tab-fuel').className = `toggle-btn ${mode === 'fuel' ? 'active fuel' : ''}`;
    
    const userSel = document.getElementById('inp-user');
    const catSel = document.getElementById('inp-cat');
    const grpCat = document.getElementById('grp-cat');
    const grpDate = document.getElementById('grp-date');
    const lblUser = document.getElementById('lbl-user');

    grpDate.classList.remove('hidden');

    if (mode === 'burn') {
        lblUser.textContent = "Who Paid?";
        grpCat.classList.remove('hidden');
        
        let userOpts = `<option value="Pool">Pool</option>`;
        userOpts += configData.members.map(m => `<option value="${m}">${m}</option>`).join('');
        userSel.innerHTML = userOpts;
        catSel.innerHTML = configData.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

        const btn = document.getElementById('btn-save');
        btn.className = `btn btn-save burn`;
        btn.textContent = document.getElementById('edit-id').value ? 'Update Burn' : 'Burn';
    } else {
        lblUser.textContent = "Who Gave?";
        grpCat.classList.add('hidden'); 
        
        userSel.innerHTML = configData.members.map(m => `<option value="${m}">${m}</option>`).join('');

        const btn = document.getElementById('btn-save');
        btn.className = `btn btn-save fuel`;
        btn.textContent = document.getElementById('edit-id').value ? 'Update Fuel' : 'Fuel';
    }
}

function openAddModal() {
    document.getElementById('edit-id').value = "";
    document.getElementById('inp-date').valueAsDate = new Date();
    document.getElementById('inp-amount').value = '';
    document.getElementById('inp-desc').value = '';
    setMode(currentMode, false); 
    document.getElementById('add-modal-overlay').classList.add('open');
    document.getElementById('inp-amount').focus();
}

function closeModal(type) {
    const id = type === 'settings' ? 'settings-modal-overlay' : 
               type === 'stats' ? 'stats-modal-overlay' : 'add-modal-overlay';
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.remove('open');
}

function renderList(transactions) {
    let totalFuel = 0, totalBurn = 0;
    const endOfToday = new Date();
    endOfToday.setHours(23,59,59,999);
    
    transactions.forEach(t => {
        let tDate = new Date();
        if (t.txnDate) {
            const parts = t.txnDate.split('-');
            tDate = new Date(parts[0], parts[1]-1, parts[2]); 
        } else if (t.timestamp) {
            tDate = t.timestamp.toDate(); 
        }
        
        if (tDate <= endOfToday) {
            if (t.type === 'fuel') totalFuel += t.amount;
            else totalBurn += t.amount;
        }
    });
    
    const bal = totalFuel - totalBurn;
    document.getElementById('pool-balance').textContent = `₱${bal.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    
    const statusDiv = document.getElementById('status-display');
    if (bal >= 0) statusDiv.innerHTML = `<span class="status-badge" style="background: var(--success-light); color: var(--success);">Pool is Safe</span>`;
    else statusDiv.innerHTML = `<span class="status-badge" style="background: var(--danger-light); color: var(--danger);">Pool Deficit</span>`;

    const list = document.getElementById('transaction-list');
    if (transactions.length === 0) { list.innerHTML = '<div class="empty-state">No transactions yet.<br>Tap + to start.</div>'; return; }

    list.innerHTML = transactions.map(t => `
        <div class="swipe-container" id="txn-${t.id}">
            <div class="swipe-bg edit">Edit</div>
            <div class="swipe-bg delete">Delete</div>
            <div class="txn-item">
                <div class="txn-info">
                    <h4>${t.desc}</h4>
                    <p>${t.user} ${t.category ? '• '+t.category : ''} • ${t.dateString || 'Today'}</p>
                </div>
                <div class="txn-amount ${t.type} ${t.amount < 0 ? 'negative' : ''}">
                    ${t.type === 'burn' ? '-' : (t.amount < 0 ? '' : '+')}₱${Math.abs(t.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}
                </div>
            </div>
        </div>
    `).join('');

    transactions.forEach(t => {
        const el = document.getElementById(`txn-${t.id}`).querySelector('.txn-item');
        attachSwipeListeners(el, t.id);
    });
}

function deleteTxn(id) {
    showConfirm("Delete Item", "Cannot undo.", async () => {
        try { await deleteDoc(doc(db, "rooms", currentRoom, "transactions", id)); showToast("Deleted"); } 
        catch(e) { showToast("Error", "error"); }
    });
}

function editTxn(id) {
    const txn = allTransactions.find(t => t.id === id);
    if (!txn) return;
    document.getElementById('edit-id').value = id;
    document.getElementById('inp-amount').value = txn.amount;
    document.getElementById('inp-desc').value = txn.desc;
    setMode(txn.type, true);
    document.getElementById('inp-user').value = txn.user;
    if (txn.type === 'burn') document.getElementById('inp-cat').value = txn.category;
    if (txn.txnDate) {
        document.getElementById('inp-date').value = txn.txnDate;
    } else if (txn.dateString) {
        const d = new Date(txn.dateString);
        if(!isNaN(d)) document.getElementById('inp-date').valueAsDate = d;
    }
    document.getElementById('add-modal-overlay').classList.add('open');
    const row = document.getElementById(`txn-${id}`).querySelector('.txn-item');
    if(row) row.style.transform = 'translateX(0)';
}

function attachSwipeListeners(element, id) {
    let touchStartX = 0; let currentX = 0; const threshold = 80;
    element.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; element.style.transition = 'none'; }, {passive: true});
    element.addEventListener('touchmove', (e) => { 
        currentX = e.changedTouches[0].screenX - touchStartX;
        if (currentX < -150) currentX = -150; if (currentX > 150) currentX = 150;
        element.style.transform = `translateX(${currentX}px)`;
    }, {passive: true});
    element.addEventListener('touchend', (e) => {
        element.style.transition = 'transform 0.2s ease-out';
        if (currentX < -threshold) element.style.transform = `translateX(-100px)`; 
        else if (currentX > threshold) element.style.transform = `translateX(100px)`;
        else element.style.transform = `translateX(0px)`;
    });
    const container = element.parentElement;
    container.querySelector('.swipe-bg.delete').onclick = () => deleteTxn(id);
    container.querySelector('.swipe-bg.edit').onclick = () => editTxn(id);
}
