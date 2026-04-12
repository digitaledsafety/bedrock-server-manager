document.addEventListener('DOMContentLoaded', () => {
    const messageBox = document.getElementById('messageBox');
    const serverStatusSpan = document.getElementById('serverStatus');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const restartButton = document.getElementById('restartButton');
    const updateButton = document.getElementById('updateButton');
    const clearLogsButton = document.getElementById('clearLogsButton');
    const downloadLogsButton = document.getElementById('downloadLogsButton');
    const propertiesForm = document.getElementById('propertiesForm');
    const propertiesContainer = document.getElementById('propertiesContainer');
    const propertiesTabs = document.getElementById('propertiesTabs');
    const consoleOutput = document.getElementById('consoleOutput'); // Get the console textarea

    // Auto-Update specific elements
    const autoUpdateConfigForm = document.getElementById('autoUpdateConfigForm');
    const autoUpdateEnabledCheckbox = document.getElementById('autoUpdateEnabled');
    const autoUpdateIntervalMinutesInput = document.getElementById('autoUpdateIntervalMinutes');

    // World Management specific elements
    const createWorldForm = document.getElementById('createWorldForm');
    const newWorldNameInput = document.getElementById('newWorldName');

    // Pack Management specific elements
    const uploadPackForm = document.getElementById('uploadPackForm');
    const packFileInput = document.getElementById('packFile');
    const packTypeSelect = document.getElementById('packType');
    const packTypeGroup = document.getElementById('packTypeGroup');
    const packWorldNameSelect = document.getElementById('packWorldName');
    const uploadPackButton = document.getElementById('uploadPackButton');


    // --- Utility Functions ---
    function showMessage(message, type = 'success') {
        messageBox.textContent = message;
        messageBox.className = type === 'success' ? 'message-box' : 'error-box';
        messageBox.style.display = 'block';
        setTimeout(() => {
            messageBox.style.display = 'none';
        }, 5000);
    }

    // Function to control button disabled states
    function setButtonStates(status) {
        if (status === 'running') {
            startButton.disabled = true;
            stopButton.disabled = false;
            restartButton.disabled = false;
            updateButton.disabled = false;
        } else if (status === 'stopped') {
            startButton.disabled = false;
            stopButton.disabled = true;
            restartButton.disabled = true;
            updateButton.disabled = false; // Allow update even if server is stopped
        } else { // unknown status
            startButton.disabled = false; // Allow starting if unknown, as it might be stopped
            stopButton.disabled = true;
            restartButton.disabled = true;
            updateButton.disabled = true; // Disable update if status is unknown
        }
    }

    // --- Pack Management Functions ---
    function handlePackFileChange() {
        if (packFileInput.files && packFileInput.files.length > 0) {
            const fileName = packFileInput.files[0].name.toLowerCase();
            if (fileName.endsWith('.mcaddon')) {
                packTypeGroup.style.display = 'none';
            } else {
                packTypeGroup.style.display = 'block';
            }
        }
    }

    async function handleUploadPack(event) {
        event.preventDefault();
        if (!packFileInput.files || packFileInput.files.length === 0) {
            showMessage('Please select a .mcpack or .mcaddon file to upload.', 'error');
            return;
        }

        const packFile = packFileInput.files[0];
        const packType = packTypeSelect.value;
        const worldName = packWorldNameSelect.value;
        const isMcAddon = packFile.name.toLowerCase().endsWith('.mcaddon');

        if (!worldName) {
            showMessage('Please select a target world for the pack.', 'error');
            return;
        }
        if (!isMcAddon && !packType) {
            showMessage('Please select a pack type.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('packFile', packFile);
        if (!isMcAddon) {
            formData.append('packType', packType);
        }
        formData.append('worldName', worldName);

        uploadPackButton.disabled = true;
        showMessage('Uploading pack...', 'success');

        try {
            const response = await fetch('/api/upload-pack', {
                method: 'POST',
                body: formData
                // 'Content-Type': 'multipart/form-data' is automatically set by browser with FormData
            });
            const data = await response.json();
            if (response.ok && data.success) {
                showMessage(data.message || 'Pack uploaded successfully!', 'success');
                uploadPackForm.reset(); // Reset form on success
            } else {
                showMessage(data.message || 'Failed to upload pack.', 'error');
            }
        } catch (error) {
            console.error('Error uploading pack:', error);
            showMessage('An error occurred while uploading the pack.', 'error');
        } finally {
            uploadPackButton.disabled = false;
        }
    }

    function updateServerStatusDisplay(status) {
        serverStatusSpan.textContent = status.toUpperCase();
        serverStatusSpan.className = status === 'running' ? 'status-indicator status-running' : 'status-indicator status-stopped';
        setButtonStates(status); // Call to update button states based on status
    }

    // --- API Calls ---
    async function fetchServerStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();
            updateServerStatusDisplay(data.status);
        } catch (error) {
            console.error('Error fetching server status:', error);
            updateServerStatusDisplay('unknown'); // Set status to unknown on error
            showMessage('Failed to fetch server status. Server might be offline or unreachable.', 'error');
        }
    }

    async function sendCommand(command) {
        try {
            showMessage(`Sending command: ${command}...`);
            // Disable all control buttons while a command is being processed
            startButton.disabled = true;
            stopButton.disabled = true;
            restartButton.disabled = true;
            updateButton.disabled = true;

            const response = await fetch(`/api/${command}`, { method: 'POST' });
            const data = await response.json();
            console.log(JSON.stringify(data));
            if (data.success) {
                showMessage(`Server ${command} initiated: ${data.message}`, 'success');
                // Give server time to change status, then fetch
                setTimeout(fetchServerStatus, 5000); // Increased delay for more robust status update
            } else {
                showMessage(`Error ${command}ing server: ${data.message}`, 'error');
                fetchServerStatus(); // Re-fetch status to reset button states if command failed
            }
        } catch (error) {
            console.error(`Error sending ${command} command:`, error);
            showMessage(`Failed to send ${command} command.`, 'error');
            fetchServerStatus(); // Re-fetch status to reset button states on network error
        }
    }

    let propertiesMetadata = {};
    let propertyCategories = [];
    let currentServerProperties = {};

    async function loadServerProperties() {
        try {
            const [propRes, metaRes] = await Promise.all([
                fetch('/api/properties'),
                fetch('/api/properties/metadata')
            ]);

            const propData = await propRes.json();
            const metaData = await metaRes.json();

            if (propData.success && metaData.success) {
                currentServerProperties = propData.properties;
                propertiesMetadata = metaData.metadata;
                propertyCategories = metaData.categories;
                renderPropertiesUI();
            } else {
                showMessage('Failed to load server properties or metadata.', 'error');
            }
        } catch (error) {
            console.error('Error loading server properties:', error);
            showMessage('Failed to load server properties.', 'error');
        }
    }

    function renderPropertiesUI() {
        propertiesTabs.innerHTML = '';
        propertiesContainer.innerHTML = '';

        propertyCategories.forEach((category, index) => {
            const tabButton = document.createElement('button');
            tabButton.type = 'button';
            tabButton.className = `tab-button ${index === 0 ? 'active' : ''}`;
            tabButton.textContent = category.label;
            tabButton.onclick = () => switchTab(category.id);
            propertiesTabs.appendChild(tabButton);

            const categorySection = document.createElement('div');
            categorySection.id = `category-${category.id}`;
            categorySection.className = `tab-content ${index === 0 ? 'active' : ''}`;

            const grid = document.createElement('div');
            grid.className = 'form-grid';

            // Filter properties for this category
            Object.entries(propertiesMetadata).forEach(([key, meta]) => {
                if (meta.category === category.id) {
                    const value = currentServerProperties[key] || '';
                    grid.appendChild(createPropertyElement(key, meta, value));
                }
            });

            // Handle "Advanced" category - include properties not in metadata
            if (category.id === 'advanced') {
                Object.entries(currentServerProperties).forEach(([key, value]) => {
                    if (!propertiesMetadata[key]) {
                        grid.appendChild(createPropertyElement(key, { label: key, type: 'string', description: 'Advanced setting' }, value));
                    }
                });
            }

            categorySection.appendChild(grid);
            propertiesContainer.appendChild(categorySection);
        });
    }

    function createPropertyElement(key, meta, value) {
        const group = document.createElement('div');
        group.className = 'form-group';

        const labelContainer = document.createElement('div');
        labelContainer.className = 'label-container';

        const label = document.createElement('label');
        label.htmlFor = key;
        label.textContent = meta.label || key;
        labelContainer.appendChild(label);

        if (meta.description) {
            const infoIcon = document.createElement('span');
            infoIcon.className = 'info-icon';
            infoIcon.textContent = '?';
            infoIcon.title = meta.description;
            labelContainer.appendChild(infoIcon);
        }
        group.appendChild(labelContainer);

        let input;
        if (meta.type === 'boolean') {
            const toggleWrapper = document.createElement('label');
            toggleWrapper.className = 'toggle-switch';

            input = document.createElement('input');
            input.type = 'checkbox';
            input.id = key;
            input.name = key;
            input.checked = value === 'true';

            const slider = document.createElement('span');
            slider.className = 'slider';

            toggleWrapper.appendChild(input);
            toggleWrapper.appendChild(slider);
            group.appendChild(toggleWrapper);
        } else if (meta.type === 'select') {
            input = document.createElement('select');
            input.id = key;
            input.name = key;
            meta.options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                option.selected = String(value) === String(opt);
                input.appendChild(option);
            });
            group.appendChild(input);
        } else {
            input = document.createElement('input');
            input.type = meta.type === 'number' ? 'number' : 'text';
            input.id = key;
            input.name = key;
            input.value = value;
            if (meta.min !== undefined) input.min = meta.min;
            if (meta.max !== undefined) input.max = meta.max;
            group.appendChild(input);
        }

        return group;
    }

    function switchTab(categoryId) {
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.toggle('active', btn.textContent === propertyCategories.find(c => c.id === categoryId).label);
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `category-${categoryId}`);
        });
    }

    async function saveServerProperties(event) {
        event.preventDefault();
        const properties = { ...currentServerProperties }; // Start with existing to preserve unedited ones

        // Iterate over all form elements to handle checkboxes (booleans) correctly
        const elements = propertiesForm.elements;
        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (el.name) {
                if (el.type === 'checkbox') {
                    properties[el.name] = el.checked ? 'true' : 'false';
                } else {
                    properties[el.name] = el.value;
                }
            }
        }

        try {
            showMessage('Saving server properties...');
            const response = await fetch('/api/properties', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(properties)
            });
            const data = await response.json();
            if (data.success) {
                showMessage('Server properties saved successfully!', 'success');
                currentServerProperties = properties;
                // Refresh worlds list if level-name changed
                loadWorlds();
            } else {
                showMessage('Failed to save server properties: ' + data.message, 'error');
            }
        } catch (error) {
            console.error('Error saving server properties:', error);
            showMessage('Failed to save server properties.', 'error');
        }
    }

    async function loadWorlds() {
        try {
            const response = await fetch('/api/worlds');
            const data = await response.json();
            if (data.success) {
                // Find the existing .world-list element to update
                const worldListContainer = document.querySelector('.world-list');
                if (worldListContainer) {
                    worldListContainer.innerHTML = ''; // Clear current list
                    if (data.worlds && data.worlds.length > 0) {
                        // Fetch current level-name to mark active world
                        const propertiesResponse = await fetch('/api/properties');
                        const propertiesData = await propertiesResponse.json();
                        const currentLevelName = propertiesData.success ? propertiesData.properties['level-name'] : '';

                        data.worlds.forEach(world => {
                            const worldItem = document.createElement('div');
                            worldItem.className = `world-item ${currentLevelName === world ? 'active' : ''}`;
                            worldItem.dataset.worldName = world;
                            worldItem.innerHTML = `
                                <span>${world}</span>
                                <button class="activate-world-button bg-blue-500 hover:bg-blue-700 text-white text-sm py-1 px-3 rounded transition duration-300" data-world-name="${world}">
                                    Activate
                                </button>
                                ${currentLevelName !== world ? `
                                <button class="delete-world-button bg-red-500 hover:bg-red-700 text-white text-sm py-1 px-3 rounded transition duration-300" data-world-name="${world}">
                                    Delete
                                </button>
                                ` : ''}
                            `;
                            worldListContainer.appendChild(worldItem);
                        });
                        addActivateButtonListeners(); // Re-add listeners after updating DOM
                        addDeleteButtonListeners(); // Re-add listeners after updating DOM
                    } else {
                        worldListContainer.innerHTML = '<p class="text-gray-600">No worlds found. Start the server to generate a default world.</p>';
                    }
                } else {
                    console.error('.world-list container not found.');
                }
            } else {
                showMessage('Failed to load worlds: ' + data.message, 'error');
            }
        } catch (error) {
            console.error('Error loading worlds:', error);
            showMessage('Failed to load worlds.', 'error');
        }
    }

    function addActivateButtonListeners() {
        document.querySelectorAll('.activate-world-button').forEach(button => {
            button.removeEventListener('click', handleActivateWorldClick); // Prevent duplicate listeners
            button.addEventListener('click', handleActivateWorldClick);
        });
    }

    function addDeleteButtonListeners() {
        document.querySelectorAll('.delete-world-button').forEach(button => {
            button.removeEventListener('click', handleDeleteWorldClick); // Prevent duplicate listeners
            button.addEventListener('click', handleDeleteWorldClick);
        });
    }

    async function handleDeleteWorldClick(event) {
        const worldName = event.target.dataset.worldName;
        if (!confirm(`Are you sure you want to delete the world '${worldName}'? This action cannot be undone.`)) return;

        try {
            showMessage(`Deleting world '${worldName}'...`);
            const response = await fetch('/api/delete-world', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ worldName })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                showMessage(data.message || `World '${worldName}' deleted.`, 'success');
                loadWorlds(); // Refresh world list
            } else {
                showMessage(data.message || `Failed to delete world '${worldName}'.`, 'error');
            }
        } catch (error) {
            console.error('Error deleting world:', error);
            showMessage('Failed to delete world.', 'error');
        }
    }

    async function handleCreateWorld(event) {
        event.preventDefault();
        const worldName = newWorldNameInput.value.trim();
        if (!worldName) {
            showMessage('Please enter a world name.', 'error');
            return;
        }

        try {
            showMessage(`Creating world '${worldName}'...`);
            const response = await fetch('/api/create-world', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ worldName })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                showMessage(data.message || `World '${worldName}' created.`, 'success');
                newWorldNameInput.value = ''; // Clear input
                loadWorlds(); // Refresh world list
            } else {
                showMessage(data.message || `Failed to create world '${worldName}'.`, 'error');
            }
        } catch (error) {
            console.error('Error creating world:', error);
            showMessage('Failed to create world.', 'error');
        }
    }

    async function handleActivateWorldClick(event) {
        const worldName = event.target.dataset.worldName;
        try {
            showMessage(`Activating world '${worldName}'...`);
            const response = await fetch('/api/activate-world', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ worldName })
            });
            const data = await response.json();
            if (response.ok) {
                showMessage(data.message || `World '${worldName}' activated.`, 'success');
                // Update active state in UI
                document.querySelectorAll('.world-item').forEach(item => {
                    item.classList.remove('active');
                });
                event.target.closest('.world-item').classList.add('active');

                // Fetch status because activation restarts the server
                setTimeout(fetchServerStatus, 2000);
            } else {
                showMessage(data.error || `Failed to activate world '${worldName}'.`, 'error');
            }
        } catch (error) {
            console.error('Error activating world:', error);
            showMessage('Failed to activate world.', 'error');
        }
    }

    // --- Auto-Update Configuration Functions ---
    async function loadAutoUpdateConfig() {
        try {
            const response = await fetch('/api/config');
            const data = await response.json();
            if (data.success) {
                autoUpdateEnabledCheckbox.checked = data.config.autoUpdateEnabled;
                autoUpdateIntervalMinutesInput.value = data.config.autoUpdateIntervalMinutes;
            } else {
                showMessage('Failed to load auto-update configuration: ' + data.message, 'error');
            }
        } catch (error) {
            console.error('Error loading auto-update config:', error);
            showMessage('Failed to load auto-update configuration.', 'error');
        }
    }

    async function saveAutoUpdateConfig(event) {
        event.preventDefault();
        const newConfig = {
            autoUpdateEnabled: autoUpdateEnabledCheckbox.checked,
            autoUpdateIntervalMinutes: parseInt(autoUpdateIntervalMinutesInput.value, 10)
        };

        if (isNaN(newConfig.autoUpdateIntervalMinutes) || newConfig.autoUpdateIntervalMinutes < 1) {
            showMessage('Update interval must be a positive number.', 'error');
            return;
        }

        try {
            showMessage('Saving auto-update settings...');
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newConfig)
            });
            const data = await response.json();
            if (data.success) {
                showMessage('Auto-update settings saved successfully!', 'success');
            } else {
                showMessage('Failed to save auto-update settings: ' + data.message, 'error');
            }
        } catch (error) {
            console.error('Error saving auto-update config:', error);
            showMessage('Failed to save auto-update settings.', 'error');
        }
    }


    // --- Event Listeners ---
    startButton.addEventListener('click', () => sendCommand('start'));
    stopButton.addEventListener('click', () => sendCommand('stop'));
    restartButton.addEventListener('click', () => sendCommand('restart'));
    updateButton.addEventListener('click', () => sendCommand('update'));

    async function handleClearLogs() {
        if (!confirm('Are you sure you want to clear the server logs?')) return;
        try {
            showMessage('Clearing server logs...');
            const response = await fetch('/api/logs/clear', { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                showMessage('Server logs cleared successfully!', 'success');
                consoleOutput.value = ''; // Immediately clear in UI
                fetchLogs(); // Refresh
            } else {
                showMessage('Failed to clear server logs: ' + data.message, 'error');
            }
        } catch (error) {
            console.error('Error clearing logs:', error);
            showMessage('Failed to clear server logs.', 'error');
        }
    }

    if (clearLogsButton) clearLogsButton.addEventListener('click', handleClearLogs);
    if (createWorldForm) createWorldForm.addEventListener('submit', handleCreateWorld);
    if (downloadLogsButton) {
        downloadLogsButton.addEventListener('click', () => {
            window.location.href = '/api/logs/download';
        });
    }
    if (propertiesForm) propertiesForm.addEventListener('submit', saveServerProperties);
    if (autoUpdateConfigForm) autoUpdateConfigForm.addEventListener('submit', saveAutoUpdateConfig);
    if (uploadPackForm) {
        uploadPackForm.addEventListener('submit', handleUploadPack);
        packFileInput.addEventListener('change', handlePackFileChange);
    }


    async function fetchLogs() {
        try {
            const response = await fetch('/api/logs');
            const data = await response.json();
            if (data.success) {
                if (consoleOutput.value !== data.logs) {
                    const isScrolledToBottom = consoleOutput.scrollHeight - consoleOutput.clientHeight <= consoleOutput.scrollTop + 1;
                    consoleOutput.value = data.logs;
                    if (isScrolledToBottom) {
                        consoleOutput.scrollTop = consoleOutput.scrollHeight;
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching logs:', error);
        }
    }

    // Initial load
    fetchServerStatus(); // This will now also set initial button states
    loadServerProperties();
    //loadWorlds();
    loadAutoUpdateConfig(); // New: Load auto-update config on page load
    addActivateButtonListeners();
    addDeleteButtonListeners();
    fetchLogs();

    // Refresh status and worlds periodically
    setInterval(fetchServerStatus, 10000); // Every 10 seconds
    setInterval(loadWorlds, 30000); // Every 30 seconds
    setInterval(fetchLogs, 5000); // Every 5 seconds

});
