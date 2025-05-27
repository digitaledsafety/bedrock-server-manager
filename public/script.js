document.addEventListener('DOMContentLoaded', () => {
    const messageBox = document.getElementById('messageBox');
    const serverStatusSpan = document.getElementById('serverStatus');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const restartButton = document.getElementById('restartButton');
    const updateButton = document.getElementById('updateButton');
    const propertiesForm = document.getElementById('propertiesForm');
    // Note: propertiesMessageDiv, worldsListDiv, and worldsMessageDiv are present in EJS but not directly used in this JS for message display, using messageBox instead.
    // const propertiesMessageDiv = document.getElementById('properties-message');
    // const worldsListDiv = document.getElementById('worlds-list');
    // const worldsMessageDiv = document.getElementById('worlds-message');
    const levelNameInput = document.getElementById('level-name'); // Get the level-name input
    const consoleOutput = document.getElementById('consoleOutput'); // Get the console textarea

    // --- Utility Functions ---
    function showMessage(message, type = 'success') {
        messageBox.textContent = message;
        messageBox.className = type === 'success' ? 'message-box' : 'error-box';
        messageBox.style.display = 'block';
        setTimeout(() => {
            messageBox.style.display = 'none';
        }, 5000);
    }

    // New function to control button disabled states
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

    async function loadServerProperties() {
        try {
            const response = await fetch('/api/properties');
            const data = await response.json();
            console.log(data);
            if (data.success) {
                // Properties are initially rendered by EJS.
                // This function is primarily for fetching and logging,
                // or if you were to dynamically re-render the form.
                console.log('Server properties loaded:', data.properties);

                // If levelNameInput exists and is a text input, ensure its value is set
                if (levelNameInput && data.properties['level-name']) {
                    levelNameInput.value = data.properties['level-name'];
                }

            } else {
                showMessage('Failed to load server properties: ' + data.message, 'error');
            }
        } catch (error) {
            console.error('Error loading server properties:', error);
            showMessage('Failed to load server properties.', 'error');
        }
    }

    async function saveServerProperties(event) {
        event.preventDefault();
        const formData = new FormData(propertiesForm);
        const properties = {};
        for (const [key, value] of formData.entries()) {
            properties[key] = value;
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
                // Refresh worlds list and active world status after saving properties
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
                            `;
                            worldListContainer.appendChild(worldItem);
                        });
                        addActivateButtonListeners(); // Re-add listeners after updating DOM
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

    function handleActivateWorldClick(event) {
        const worldName = event.target.dataset.worldName;
        if (levelNameInput) {
            levelNameInput.value = worldName; // This updates the text input
            showMessage(`'level-name' property updated to '${worldName}'. Remember to click "Save Properties".`, 'success');

            // Update active state in UI
            document.querySelectorAll('.world-item').forEach(item => {
                item.classList.remove('active');
            });
            event.target.closest('.world-item').classList.add('active');
        } else {
            console.error('level-name input not found.');
            showMessage('Could not find level-name input to update.', 'error');
        }
    }


    // --- Event Listeners ---
    startButton.addEventListener('click', () => sendCommand('start'));
    stopButton.addEventListener('click', () => sendCommand('stop'));
    restartButton.addEventListener('click', () => sendCommand('restart'));
    updateButton.addEventListener('click', () => sendCommand('update'));
    propertiesForm.addEventListener('submit', saveServerProperties);

    // Initial load
    fetchServerStatus(); // This will now also set initial button states
});
