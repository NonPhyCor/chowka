import { SpotifyApi } from 'https://esm.sh/@spotify/web-api-ts-sdk';

// --- 0. CONFIG & GLOBALS ---
const { createClient } = window.supabase;
const SUPABASE_URL = 'your-supabase-url';
const SUPABASE_KEY = 'your-supabase-key';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Spotify Config
const spotifyClientId = "your-spotify-api-key";
const spotifyRedirectUrl = window.location.href.split('?')[0];
const spotifyScopes = ["user-read-private", "user-read-email", "user-read-recently-played"];
const spotifySdk = SpotifyApi.withUserAuthorization(spotifyClientId, spotifyRedirectUrl, spotifyScopes);

let currentUser = null;
let tempAssets = [];
let willSections = [];

// --- 1. ATTACH FUNCTIONS TO WINDOW ---
window.showView = function (viewId) {
    document.querySelectorAll('.app-view').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');

    // Update Nav states
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    let navIndex = 0;
    if(viewId.includes('home')) navIndex = 0;
    else if(viewId.includes('digital')) navIndex = 1;
    else if(viewId.includes('security') || viewId.includes('heir') || viewId.includes('recovery')) navIndex = 2;
    else if(viewId.includes('will')) navIndex = 3;

    document.querySelectorAll('.nav-rail').forEach(rail => {
        const items = rail.querySelectorAll('.nav-item');
        if(items[navIndex]) items[navIndex].classList.add('active');
    });

    if (viewId === 'view-profile' && currentUser) {
        document.getElementById('profile-email').value = currentUser.email;
        checkSpotifyStatus();
    }
    if (viewId === 'view-will') {
        loadWill();
    }
};

window.handleSignUp = async function () {
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;

    if (password !== confirm) { alert("Passwords do not match"); return; }

    const { data, error } = await sb.auth.signUp({ email, password });

    if (error) {
        alert("Error: " + error.message);
    } else {
        if (data.user) {
            await sb.from('profiles').insert([{ id: data.user.id, email: email }]);
            currentUser = data.user;
            updateUserInterface(email);
            window.showView('view-home');
        }
    }
};

window.handleLogin = async function () {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;

    const { data, error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
        alert("Login Failed: " + error.message);
    } else {
        currentUser = data.user;
        updateUserInterface(email);
        window.showView('view-home');
    }
};

// --- UPDATED: LOGOUT LOGIC ---
window.handleLogout = async function () {
    await sb.auth.signOut();
    spotifySdk.logOut(); 
    localStorage.clear();
    sessionStorage.clear();
    currentUser = null;
    window.location.reload();
};

window.handlePasswordUpdate = async function () {
    const newPwd = document.getElementById('new-password').value;
    if (!newPwd) return;

    const msgEl = document.getElementById('pwd-msg');
    const { error } = await sb.auth.updateUser({ password: newPwd });

    msgEl.style.display = 'block';
    if (error) {
        msgEl.className = 'status-message error';
        msgEl.innerText = 'Error: ' + error.message;
    } else {
        msgEl.className = 'status-message success';
        msgEl.innerText = 'Password updated successfully!';
        document.getElementById('new-password').value = '';
    }
};

window.manualCheckIn = async function() {
    if (!currentUser) return;
    
    if(confirm("This will update your 'Last Active' timestamp to NOW. Proceed?")) {
        const { error } = await sb.from('profiles')
            .update({ last_spotify_activity: new Date().toISOString() })
            .eq('id', currentUser.id);
            
        if (error) alert("Error updating status: " + error.message);
        else alert("Status updated! The Death Switch timer has been reset.");
    }
};

// --- SPOTIFY FUNCTIONS ---
window.linkSpotify = async function () {
    try {
        await spotifySdk.authenticate();
    } catch (error) {
        console.error("Spotify Auth Start Error:", error);
        alert("Could not start Spotify login: " + error.message);
    }
};

window.unlinkSpotify = async function () {
    if (!confirm('Are you sure you want to unlink your Spotify account?')) {
        return;
    }
    try {
        // 1. Clear from Database (CRITICAL for the logic to work)
        if (currentUser) {
            await sb.from('profiles')
                .update({ spotify_refresh_token: null, last_spotify_activity: null })
                .eq('id', currentUser.id);
        }

        // 2. Clear from SDK
        await spotifySdk.logOut();

        // 3. Update UI
        const statusDiv = document.getElementById('spotify-status');
        const btn = document.getElementById('spotify-btn');
        btn.innerHTML = '<span class="material-symbols-outlined">music_note</span> Link to Spotify';
        btn.style.backgroundColor = ''; // Reset color
        btn.disabled = false;
        btn.onclick = window.linkSpotify;
        btn.style.opacity = '1';
        statusDiv.innerText = '';
        const unlinkBtn = document.getElementById('spotify-unlink-btn');
        if (unlinkBtn) unlinkBtn.remove();

        alert('Spotify account unlinked successfully!');
    } catch (error) {
        console.error('Spotify Unlink Error:', error);
        alert('Error unlinking Spotify: ' + error.message);
    }
};

// --- UPDATED: CHECK SPOTIFY STATUS (DB FALLBACK) ---
async function checkSpotifyStatus() {
    const statusDiv = document.getElementById('spotify-status');
    const btn = document.getElementById('spotify-btn');
    
    // Helper to create the Unlink button
    const addUnlinkButton = () => {
        let unlinkBtn = document.getElementById('spotify-unlink-btn');
        if (!unlinkBtn) {
            unlinkBtn = document.createElement('button');
            unlinkBtn.id = 'spotify-unlink-btn';
            unlinkBtn.className = 'btn-filled';
            unlinkBtn.style.cssText = 'background-color: #3b1410; color: #f2b8b5; margin-top: 12px;';
            unlinkBtn.innerHTML = '<span class="material-symbols-outlined">link_off</span> Unlink Spotify';
            unlinkBtn.onclick = window.unlinkSpotify;
            btn.parentElement.appendChild(unlinkBtn);
        }
    };

    try {
        // 1. Try Browser SDK (Active Session)
        const token = await spotifySdk.getAccessToken();
        
        if (token) {
            // --- SCENARIO A: Browser is connected ---
            const profile = await spotifySdk.currentUser.profile();
            btn.innerHTML = `<span class="material-symbols-outlined">check_circle</span> Connected as ${profile.display_name}`;
            btn.disabled = true;
            btn.style.opacity = "0.8";
            btn.onclick = null; // Disable click
            addUnlinkButton();

            // Update History
            try {
                const history = await spotifySdk.player.getRecentlyPlayedTracks(1);
                if (history.items.length > 0) {
                    const rawTime = history.items[0].played_at;
                    statusDiv.innerText = `Last heard at: ${new Date(rawTime).toLocaleString()}`;

                    if (currentUser) {
                        const updatePayload = { last_spotify_activity: rawTime };
                        if (token.refresh_token) updatePayload.spotify_refresh_token = token.refresh_token;
                        await sb.from('profiles').update(updatePayload).eq('id', currentUser.id);
                    }
                }
            } catch (e) { console.error("Error fetching recent history:", e); }

        } else {
            // --- SCENARIO B: Browser Session Lost, Check Database ---
            // This happens after logout/login because localStorage was cleared
            if (!currentUser) return;
            
            const { data: profileData } = await sb.from('profiles')
                .select('spotify_refresh_token, last_spotify_activity')
                .eq('id', currentUser.id)
                .single();

            if (profileData && profileData.spotify_refresh_token) {
                // DB says we are linked!
                btn.innerHTML = `<span class="material-symbols-outlined">cloud_done</span> Linked (Server)`;
                btn.style.backgroundColor = '#1b3a2e'; // Dark Green indicates saved state
                btn.title = "Click to refresh browser session";
                btn.disabled = false; // Allow clicking to "Refresh" browser session
                btn.onclick = window.linkSpotify; 
                
                if (profileData.last_spotify_activity) {
                    statusDiv.innerText = `Last recorded: ${new Date(profileData.last_spotify_activity).toLocaleString()}`;
                }
                addUnlinkButton();
            } else {
                // Truly disconnected
                statusDiv.innerText = "";
                const unlinkBtn = document.getElementById('spotify-unlink-btn');
                if (unlinkBtn) unlinkBtn.remove();
            }
        }
    } catch (e) {
        console.log("Spotify check status error:", e);
        // Fallback logic same as Scenario B
        if (currentUser) {
             const { data: profileData } = await sb.from('profiles')
                .select('spotify_refresh_token')
                .eq('id', currentUser.id)
                .single();
             
             if (profileData && profileData.spotify_refresh_token) {
                btn.innerHTML = `<span class="material-symbols-outlined">cloud_done</span> Linked (Server)`;
                btn.style.backgroundColor = '#1b3a2e';
                btn.onclick = window.linkSpotify; 
                addUnlinkButton();
             }
        }
    }
}

// --- ASSET & VAULT LOGIC ---
window.addAsset = function () {
    const name = document.getElementById('new-asset-name').value;
    const detail = document.getElementById('new-asset-detail').value;
    if (!name) return;
    tempAssets.push({ name, detail });
    renderAssets();
    document.getElementById('new-asset-name').value = '';
    document.getElementById('new-asset-detail').value = '';
};

window.removeAsset = function (index) {
    tempAssets.splice(index, 1);
    renderAssets();
};

function renderAssets() {
    const container = document.getElementById('assets-container');
    container.innerHTML = '';
    tempAssets.forEach((asset, index) => {
        container.innerHTML += `
                    <div class="asset-item">
                        <div>
                            <div style="font-weight:500;">${asset.name}</div>
                            <div style="font-size:0.8rem; color:#CAC4D0;">${asset.detail}</div>
                        </div>
                        <span class="material-symbols-outlined" style="cursor:pointer; font-size:1.2rem;" onclick="removeAsset(${index})">close</span>
                    </div>
                `;
    });
}

// --- DIGITAL ASSETS LOGIC ---
window.lockDigitalAsset = async function() {
    if (!currentUser) {
        alert("Please sign in first.");
        return;
    }

    const heirEmail = document.getElementById('digital-heir-email').value;
    const payload = document.getElementById('digital-payload').value;
    const pinHint = document.getElementById('digital-pin-hint').value; 
    let pin = document.getElementById('digital-pin').value.trim();

    if(!heirEmail || !payload || !pin) {
        alert("All fields are required.");
        return;
    }

    try {
        const mdk = window.secrets.random(256); 
        const encryptedPayload = window.CryptoJS.AES.encrypt(payload, mdk).toString();
        const shares = window.secrets.share(mdk, 3, 2);
        const heirShard = shares[1]; 
        const systemShard = shares[2];
        const encryptedHeirShard = window.CryptoJS.AES.encrypt(heirShard, pin).toString();

        const { error } = await sb.from('vaults').insert([{
            user_id: currentUser.id,
            system_shard: systemShard, 
            heir_shard_encrypted: encryptedHeirShard, 
            assets: [{ type: 'digital_payload', ciphertext: encryptedPayload }],
            pin_hint: pinHint,
            created_at: new Date().toISOString()
        }]);

        if (error) throw error;

        document.getElementById('digital-payload').value = '';
        document.getElementById('digital-pin').value = '';
        pin = null; 

        downloadShard(heirShard); 
        
        const subject = "Digital Asset Key - Secure";
        const body = `You have been designated as a digital heir.\n\nYour Access PIN Hint: "${pinHint}"\n\nUpon the owner's inactivity, you can use the shard below plus the PIN provided to you to unlock the assets.\n\nYOUR ENCRYPTED SHARD:\n${encryptedHeirShard}`;
        const mailtoLink = `mailto:${heirEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

        const copyContainer = document.getElementById('digital-manual-copy-container');
        const copyText = document.getElementById('digital-manual-shard-text');
        copyText.value = encryptedHeirShard;
        copyContainer.style.display = 'block';

        alert("Digital Assets Locked. Check your downloads for the Master Shard.");
        window.location.href = mailtoLink;
        
        document.querySelectorAll('#digital-pin-container .pin-digit').forEach(input => input.value = '');

    } catch(err) {
        console.error(err);
        alert("Error locking digital assets: " + err.message);
    }
};

window.lockVault = async function () {
    if (!currentUser) {
        alert("You must be logged in. Please sign in first.");
        return;
    }

    const heirEmail = document.getElementById('heir-email').value;
    const pin = document.getElementById('heir-pin').value.trim();
    const pinHint = document.getElementById('heir-pin-hint').value; 
    const willSection = document.getElementById('heir-will-section').value;
    const secretMessage = document.getElementById('secret-message').value;

    if (!willSection || !pin || !heirEmail) {
        alert("Missing Data: Please fill in heir email, will section, and PIN.");
        return;
    }

    try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) {
            alert("Your session has expired. Please sign in again.");
            window.showView('view-landing');
            return;
        }

        const { data: existingWill } = await sb.from('wills').select('will_sections').eq('user_id', currentUser.id).single();
        if (existingWill && existingWill.will_sections) {
            willSections = existingWill.will_sections;
        }

        willSections.push({
            heirEmail: heirEmail,
            assets: [...tempAssets],
            willSection: willSection
        });

        const completeWill = generateWillDocument();
        await signAndSaveWill(completeWill);

        const secretToEncrypt = secretMessage || willSection;
        const secretHex = window.secrets.str2hex(secretToEncrypt);
        const shards = window.secrets.share(secretHex, 3, 2);
        const encryptedHeirShard = window.CryptoJS.AES.encrypt(shards[1], pin).toString();

        const { error } = await sb.from('vaults').insert([{
            user_id: currentUser.id,
            system_shard: shards[2],
            heir_shard_encrypted: encryptedHeirShard,
            assets: tempAssets,
            pin_hint: pinHint
        }]);

        if (error) throw error;

        await sb.from('profiles').update({ heir_email: heirEmail }).eq('id', currentUser.id);
        downloadShard(shards[0]);

        const subject = "Your Digital Legacy Key";
        const body = `You have been designated as an heir.\n\nYour Access PIN Hint: "${pinHint}"\n\nTo access your legacy, you will need the shard below and the PIN provided to you.\n\nYOUR ENCRYPTED SHARD:\n${encryptedHeirShard}`;
        const mailtoLink = `mailto:${heirEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

        const copyContainer = document.getElementById('manual-copy-container');
        const copyText = document.getElementById('manual-shard-text');
        copyText.value = encryptedHeirShard;
        copyContainer.style.display = 'block';

        alert("Vault Locked! Scroll down to copy the shard if email didn't open.");
        window.location.href = mailtoLink;

        tempAssets = [];
        renderAssets();

        document.getElementById('heir-email').value = '';
        document.getElementById('heir-will-section').value = '';
        document.getElementById('secret-message').value = '';
        document.getElementById('new-asset-name').value = '';
        document.getElementById('new-asset-detail').value = '';
        document.getElementById('heir-pin').value = '';
        document.querySelectorAll('#heir-pin-container .pin-digit').forEach(input => input.value = '');

    } catch (err) {
        console.error(err);
        alert("Error: " + err.message);
    }
};

// --- SECURE RECOVERY LOGIC (30s Threshold) ---
window.claimLegacy = async function () {
    const targetEmail = document.getElementById('claim-email').value.trim();
    const pin = document.getElementById('claim-pin').value.trim();
    const pastedShard = document.getElementById('recovery-shard').value.trim();

    if (!pastedShard) { alert("Please paste the encrypted shard"); return; }
    if (pastedShard.startsWith('801')) {
        alert("ACCESS DENIED. You pasted the Master Shard.");
        return;
    }

    try {
        // 1. Call Server-Side Security Function (RPC)
        // CHANGED: threshold_seconds set to 30 for demo
        const { data, error } = await sb.rpc('get_vault_securely', { 
            target_email: targetEmail,
            threshold_seconds: 30 
        });

        if (error) {
             alert("Error fetching vault: " + error.message);
             return;
        }

        if (!data || data.length === 0) {
            alert("No vault found for this user.");
            return;
        }

        const vault = data[0];

        if (vault.pin_hint) {
            document.getElementById('hint-display-area').style.display = 'block';
            document.getElementById('recovered-hint').innerText = vault.pin_hint;
        }

        // Check "Alive" Status
        if (!vault.is_released || !vault.system_shard) {
            alert("ACCESS DENIED.\n\nThe system detects activity from the owner within the last 30 seconds.\nThe vault remains locked.");
            return;
        }

        // Decrypt User's Heir Shard (S2)
        const bytes = window.CryptoJS.AES.decrypt(pastedShard, pin);
        const decryptedHeirShard = bytes.toString(window.CryptoJS.enc.Utf8);

        if (!decryptedHeirShard || !decryptedHeirShard.startsWith('80')) {
            throw new Error("Invalid PIN or Shard");
        }

        // Combine Shares
        const combinedHex = window.secrets.combine([decryptedHeirShard, vault.system_shard]);
        
        document.getElementById('final-reveal').style.display = 'block';
        const assetsList = document.getElementById('revealed-assets');
        assetsList.innerHTML = '';

        if (vault.assets && vault.assets.length > 0 && vault.assets[0].type === 'digital_payload') {
            const encryptedPayload = vault.assets[0].ciphertext;
            const decryptedBytes = window.CryptoJS.AES.decrypt(encryptedPayload, combinedHex);
            const decryptedSecret = decryptedBytes.toString(window.CryptoJS.enc.Utf8);
            
            document.getElementById('revealed-secret').innerText = decryptedSecret;
            assetsList.innerHTML = '<li><em>Encrypted Digital Assets Decrypted Successfully.</em></li>';
        } 
        else {
            const secretMessage = window.secrets.hex2str(combinedHex);
            document.getElementById('revealed-secret').innerText = secretMessage;

            if (vault.assets && vault.assets.length > 0) {
                vault.assets.forEach(asset => {
                    const li = document.createElement('li');
                    li.innerHTML = `<strong>${asset.name}</strong>: ${asset.detail}`;
                    li.style.marginBottom = '4px';
                    assetsList.appendChild(li);
                });
            } else {
                assetsList.innerHTML = '<li>No specific assets listed.</li>';
            }
        }
        
        document.getElementById('claim-pin').value = '';

    } catch (e) {
        console.error(e);
        alert("Recovery Failed.\n\n1. Is the PIN correct? (Check Hint)\n2. Did you paste the correct encrypted shard string?");
    }
};

// --- WILL GENERATION ---
function generateWillDocument() {
    if (willSections.length === 0) return "No will sections have been created yet.";

    let will = "LAST WILL AND TESTAMENT\n\n";
    will += `I, ${currentUser?.email} (User), hereby declare this to be my Last Will and Testament.\n\n`;
    will += `Created: ${new Date().toLocaleString()}\n\n`;

    willSections.forEach((section, index) => {
        will += `\nSECTION ${index + 1}\n`;
        will += `TO: ${section.heirEmail}\n\n`;

        if (section.assets && section.assets.length > 0) {
            will += "ASSETS:\n";
            section.assets.forEach(asset => {
                will += `  • ${asset.name}: ${asset.detail}\n`;
            });
            will += "\n";
        }

        will += "BEQUEST:\n";
        will += `${section.willSection}\n`;
    });

    return will;
}


async function signAndSaveWill(willText) {
    try {
        // 1. Get or Generate Keys
        let keyPair;
        const storedKeys = localStorage.getItem('user_pki_keys');

        if (storedKeys) {
            const parsed = JSON.parse(storedKeys);
            const privateKey = await importKey(parsed.privateKey, "sign");
            const publicKey = await importKey(parsed.publicKey, "verify");
            keyPair = { privateKey, publicKey };
        } else {
            keyPair = await generateKeyPair();
            const expPrivate = await exportKey(keyPair.privateKey);
            const expPublic = await exportKey(keyPair.publicKey);
            localStorage.setItem('user_pki_keys', JSON.stringify({
                privateKey: expPrivate,
                publicKey: expPublic
            }));
        }

        // 2. Sign the Text
        const cryptoSignature = await signData(keyPair.privateKey, willText);

        // 3. Save to Supabase
        const { error } = await sb.from('wills').upsert({
            user_id: currentUser.id,
            will_text: willText,
            crypto_signature: cryptoSignature,
            will_sections: willSections,
            updated_at: new Date().toISOString()
        }, {
            onConflict: 'user_id' // Update if user already has a will
        });

        if (error) throw error;

    } catch (e) {
        console.error("Signing Error:", e);
        throw e;
    }
}

// --- PKI CRYPTO FUNCTIONS ---
async function generateKeyPair() {
    return await window.crypto.subtle.generateKey(
        {
            name: "RSA-PSS",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        },
        true,
        ["sign", "verify"]
    );
}

async function exportKey(key) {
    return await window.crypto.subtle.exportKey("jwk", key);
}

async function importKey(jwk, type) {
    return await window.crypto.subtle.importKey(
        "jwk",
        jwk,
        {
            name: "RSA-PSS",
            hash: "SHA-256",
        },
        true,
        [type]
    );
}

async function signData(privateKey, data) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(data);
    const signature = await window.crypto.subtle.sign(
        {
            name: "RSA-PSS",
            saltLength: 32,
        },
        privateKey,
        encoded
    );
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function verifySignature(publicKey, signatureB64, data) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(data);
    const signature = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));

    return await window.crypto.subtle.verify(
        {
            name: "RSA-PSS",
            saltLength: 32,
        },
        publicKey,
        signature,
        encoded
    );
}

window.loadWill = async function () {
    try {
        // Fetch will from Supabase
        const { data: willData, error } = await sb
            .from('wills')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
            throw error;
        }

        if (willData) {
            // Load will sections into memory
            willSections = willData.will_sections || [];

            // Display the will text
            document.getElementById('will-display').innerText = willData.will_text || 'No will generated yet.';

            // Verify Crypto Signature
            const storedKeys = localStorage.getItem('user_pki_keys');
            const statusEl = document.getElementById('pki-status');
            const msgEl = document.getElementById('pki-msg');

            if (willData.crypto_signature && storedKeys) {
                try {
                    const parsedKeys = JSON.parse(storedKeys);
                    const publicKey = await importKey(parsedKeys.publicKey, "verify");
                    const isValid = await verifySignature(publicKey, willData.crypto_signature, willData.will_text);

                    statusEl.style.display = 'block';
                    if (isValid) {
                        msgEl.innerText = "Cryptographically Verified";
                        msgEl.style.color = "#a6e8c3"; // Greenish
                    } else {
                        msgEl.innerText = "Signature Mismatch (Tampered)";
                        msgEl.style.color = "#F2B8B5"; // Reddish
                    }
                } catch (e) {
                    console.error("Verification Error", e);
                    statusEl.style.display = 'none';
                }
            } else {
                statusEl.style.display = 'none';
            }
        } else {
            document.getElementById('will-display').innerText = 'No will generated yet. Create heirs to build your will.';
        }
    } catch (e) {
        console.error("Error loading will:", e);
        document.getElementById('will-display').innerText = 'Error loading will. Please try again.';
    }
};

window.downloadWill = async function () {
    try {
        // Fetch will from Supabase
        const { data: willData, error: willError } = await sb
            .from('wills')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();

        if (willError || !willData) {
            alert("No signed will found. Please create a will first.");
            return;
        }

        const storedKeys = localStorage.getItem('user_pki_keys');
        if (!storedKeys) {
            alert("No cryptographic keys found. Unable to generate PDF.");
            return;
        }

        const keys = JSON.parse(storedKeys);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Title
        doc.setFontSize(20);
        doc.text("Last Will and Testament", 105, 20, { align: "center" });

        // Date
        doc.setFontSize(10);
        doc.text(`Date: ${new Date(willData.updated_at).toLocaleString()}`, 105, 30, { align: "center" });

        // Will Text
        doc.setFontSize(12);
        doc.text("Will Content:", 20, 50);

        doc.setFont("helvetica", "normal");
        const splitText = doc.splitTextToSize(willData.will_text, 170);
        doc.text(splitText, 20, 60);

        // Calculate Y position after text
        let yPos = 60 + (splitText.length * 7) + 20;

        // Add new page if needed
        if (yPos > 250) {
            doc.addPage();
            yPos = 20;
        }

        // Cryptographic Details
        doc.setFontSize(14);
        doc.text("Cryptographic Verification", 20, yPos);
        yPos += 10;

        doc.setFont("courier", "normal");
        doc.setFontSize(8);

        doc.text("Digital Signature:", 20, yPos);
        yPos += 5;
        const splitSig = doc.splitTextToSize(willData.crypto_signature, 170);
        doc.text(splitSig, 20, yPos);
        yPos += (splitSig.length * 4) + 10;

        if (yPos > 270) {
            doc.addPage();
            yPos = 20;
        }

        doc.text("Public Key (RSA-PSS):", 20, yPos);
        yPos += 5;
        const splitKey = doc.splitTextToSize(JSON.stringify(keys.publicKey), 170);
        doc.text(splitKey, 20, yPos);

        doc.save("signed_will.pdf");
    } catch (error) {
        console.error("Error generating PDF:", error);
        alert("Error generating PDF. Please try again.");
    }
};

// --- UTILS ---
window.updateHeirPin = function () {
    const inputs = document.querySelectorAll('#heir-pin-container .pin-digit');
    document.getElementById('heir-pin').value = Array.from(inputs).map(i => i.value).join('');
};

window.updateClaimPin = function () {
    const inputs = document.querySelectorAll('#claim-pin-container .pin-digit');
    document.getElementById('claim-pin').value = Array.from(inputs).map(i => i.value).join('');
};

window.updateDigitalPin = function () {
    const inputs = document.querySelectorAll('#digital-pin-container .pin-digit');
    document.getElementById('digital-pin').value = Array.from(inputs).map(i => i.value).join('');
};

function downloadShard(text) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', 'MASTER_SHARD_DO_NOT_SHARE.txt');
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

function setupPinInputs(containerId, hiddenInputId, updateFunction) {
    const container = document.getElementById(containerId);
    const inputs = container.querySelectorAll('.pin-digit');
    inputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            if (input.value.length === 1 && index < inputs.length - 1) inputs[index + 1].focus();
            updateFunction();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && input.value === '' && index > 0) inputs[index - 1].focus();
        });
    });
}

function updateUserInterface(email) {
    const initials = email.substring(0, 2).toUpperCase();
    document.querySelectorAll('.user-initials-display').forEach(el => el.textContent = initials);
}

// --- INIT ---
document.addEventListener("DOMContentLoaded", async () => {
    // 1. Supabase Session
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        currentUser = session.user;
        updateUserInterface(currentUser.email);
        window.showView('view-home');
    } else {
        window.showView('view-landing');
    }

    // 2. PIN Inputs
    setupPinInputs('heir-pin-container', 'heir-pin', window.updateHeirPin);
    setupPinInputs('claim-pin-container', 'claim-pin', window.updateClaimPin);
    setupPinInputs('digital-pin-container', 'digital-pin', window.updateDigitalPin);

    // 3. Spotify Redirect Handling
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
        try {
            await spotifySdk.authenticate();
            window.history.replaceState({}, document.title, window.location.pathname);
            if (currentUser) {
                window.showView('view-profile');
            }
        } catch (e) {
            console.error("Spotify Login failed", e);
        }
    }

    // 4. Theme Initialization
    const savedTheme = localStorage.getItem('app_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcons(savedTheme);
});

// --- THEME LOGIC ---
window.toggleTheme = function () {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('app_theme', newTheme);

    updateThemeIcons(newTheme);
};

function updateThemeIcons(theme) {
    const iconName = theme === 'dark' ? 'light_mode' : 'dark_mode';
    const icons = document.querySelectorAll('[id^="theme-icon"]');
    icons.forEach(icon => icon.innerText = iconName);

}
