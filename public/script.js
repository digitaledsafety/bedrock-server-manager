document.addEventListener('DOMContentLoaded', () => {
    const serverStatusElement = document.getElementById('serverStatus');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const restartButton = document.getElementById('restartButton');
    const updateButton = document.getElementById('updateButton');
    const propertiesForm = document.getElementById('propertiesForm');
    const worldSelect = document.getElementById('worldSelect');
    const activateWorldButton = document.getElementById('activateWorldButton');
    const messageBox = document.getElementById('messageBox');

    // Function to update server status display
    async function updateServerStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();
            serverStatusElement.textContent = data.status.toUpperCase();
            serverStatusElement.className = `status-indicator status-${data.status}`;

            // Enable/disable buttons based on status
            if (data.status === 'running') {
                startButton.disabled = true;
                stopButton.disabled = false;
                restartButton.disabled = false;
            } else {
                startButton.disabled = false;
                stopButton.disabled = true;
                restartButton.disabled = true;
            }
        } catch (error) {
            console.error('Error fetching server status:', error);
            serverStatusElement.textContent = 'UNKNOWN';
            serverStatusElement.className = 'status-indicator';
            startButton.disabled = false;
            stopButton.disabled = false;
            restartButton.disabled = false;
        }
    }

    // Function to display messages
    function showMessage(message, isError = false) {
        messageBox.textContent = message;
        messageBox.className = isError ? 'error-box' : 'message-box';
        messageBox.style.display = 'block';
        setTimeout(() => {
            messageBox.style.display = 'none';
        }, 5000);
    }

    // Event Listeners for server control buttons
    startButton.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/start', { method: 'POST' });
            const data = await response.json();
            showMessage(data.message);
            updateServerStatus();
        } catch (error) {
            showMessage(`Error starting server: ${error.message}`, true);
        }
    });

    stopButton.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/stop', { method: 'POST' });
            const data = await response.json();
            showMessage(data.message);
            updateServerStatus();
        } catch (error) {
            showMessage(`Error stopping server: ${error.message}`, true);
        }
    });

    restartButton.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/restart', { method: 'POST' });
            const data = await response.json();
            showMessage(data.message);
            updateServerStatus();
        } catch (error) {
            showMessage(`Error restarting server: ${error.message}`, true);
        }
    });

    updateButton.addEventListener('click', async () => {
        try {
            updateButton.disabled = true;
            updateButton.textContent = 'Checking for Updates...';
            const response = await fetch('/api/update', { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                showMessage(data.message);
            } else {
                showMessage(data.message || 'Update failed.', true);
            }
            updateServerStatus();
        } catch (error) {
            showMessage(`Error during update: ${error.message}`, true);
        } finally {
            updateButton.disabled = false;
            updateButton.textContent = 'Check & Install Update';
        }
    });

    // Load server properties into the form
    async function loadServerProperties() {
        try {
            const response = await fetch('/api/properties');
            const properties = await response.json();
            propertiesForm.innerHTML = ''; // Clear existing inputs

            for (const key in properties) {
                if (Object.hasOwnProperty.call(properties, key)) {
                    const div = document.createElement('div');
                    div.className = 'form-group';
                    div.innerHTML = `
                        <label for="<span class="math-inline">\{key\}"\></span>${key}:</label>
                        <input type="text" id="<span class="math-inline">\{key\}" name\="</span>{key}" value="${properties[key]}">
                    `;
                    propertiesForm.appendChild(div);
                }
            }
        } catch (error) {
            showMessage(`Failed to load server properties: ${error.message}`, true);
        }
    }

    // Save server properties from the form
    propertiesForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(propertiesForm);
        const newProperties = {};
        for (const [key, value] of formData.entries()) {
            newProperties[key] = value;
        }

        try {
            const response = await fetch('/api/properties', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newProperties)
            });
            const data = await response.json();
            showMessage(data.message);
        } catch (error) {
            showMessage(`Error saving properties: ${error.message}`, true);
        }
    });

    // Load worlds into the select dropdown
    async function loadWorlds() {
        try {
            const response = await fetch('/api/worlds');
            const data = await response.json();
            worldSelect.innerHTML = '<option value="">Select a world...</option>'; // Clear and add default

            data.worlds.forEach(world => {
                const option = document.createElement('option');
                option.value = world;
                option.textContent = world;
                worldSelect.appendChild(option);
            });

            // Set current active world in dropdown
            const properties = await fetch('/api/properties').then(res => res.json());
            if (properties['level-name']) {
                worldSelect.value = properties['level-name'];
            }

        } catch (error) {
            showMessage(`Failed to load worlds: ${error.message}`, true);
        }
    }

    // Activate selected world
    activateWorldButton.addEventListener('click', async () => {
        const worldName = worldSelect.value;
        if (!worldName) {
            showMessage('Please select a world to activate.', true);
            return;
        }

        try {
            const response = await fetch('/api/activate-world', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ worldName })
            });
            const data = await response.json();
            if (response.ok) {
                showMessage(data.message);
                updateServerStatus(); // Status might change due to restart
            } else {
                showMessage(data.error, true);
            }
        } catch (error) {
            showMessage(`Error activating world: ${error.message}`, true);
        }
    });

    // Initial loads
    updateServerStatus();
    //loadServerProperties();
    loadWorlds();

    // Refresh status and worlds periodically
    setInterval(updateServerStatus, 10000); // Every 10 seconds
    setInterval(loadWorlds, 30000); // Every 30 seconds
});