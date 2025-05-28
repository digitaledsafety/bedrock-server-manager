# Your Awesome Minecraft Bedrock Server Manager!

Hey there! This app is super handy for looking after your Minecraft Bedrock Dedicated Server. You can fire it up, shut it down, restart it, grab updates, tweak settings, sort out your worlds, and even set up automatic updates! How cool is that?! Oh, and it's built to be **mobile-friendly**, so you can easily manage your server right from your phone or tablet!

**Just so you know: This is a fan-made tool! It's not officially linked to or endorsed by Mojang, Minecraft, or Microsoft.**

---

## What's Inside?

1.  [Stuff You'll Need](#1-prerequisites)
2.  [Getting It Set Up](#2-installation)
    * [Node.js for Windows](#nodejs-installation-windows)
    * [Node.js for Linux](#nodejs-installation-linux)
3.  [App Prep](#3-application-setup)
4.  [Let's Get This Party Started!](#4-starting-the-application)
5.  [How to Use It](#5-basic-usage)
    * [Server Buttons](#server-buttons)
    * [Auto-Update Fun](#auto-update-fun)
    * [Server Settings](#server-settings)
    * [World Magic](#world-magic)

---

## 1. Stuff You'll Need

Before we jump in, just make sure you've got these bits and bobs ready:

* **Node.js and npm:** This app runs on Node.js, and `npm` (that's Node Package Manager) comes right along with it when you install Node.js. Easy peasy!

* **Minecraft Bedrock Dedicated Server:** This manager works with a Minecraft server you've already got. You should've downloaded it and probably even run it once to get all the basic files ready.

* **Unzip Tool (Linux folks only):** If you're on Linux, you'll need `unzip` to, well, unzip files! Just run `sudo apt-get install unzip` or `sudo yum install unzip` if you haven't already.

* **Systemd (Linux folks only):** If you're thinking about running your server seriously, `systemd` is your friend. It helps keep things running smoothly. The app uses some basic commands to stop/start the server, but `systemd` is great for a more solid setup.

* **PowerShell (Windows folks only):** Just make sure PowerShell is ready to go on your Windows machine.

---

## 2. Getting It Set Up

### Node.js for Windows

1.  **Grab Node.js:** Head over to the official Node.js website: [https://nodejs.org/en/download/](https://nodejs.org/en/download/)
2.  **Get the Installer:** Download the Windows Installer (`.msi` file) for the latest LTS (that's Long Term Support) version. It's the stable one!
3.  **Run It!** Double-click that `.msi` file and just follow the steps. Sticking with the default options, including npm, is usually a good shout.
4.  **Check It Out:** Open a fresh Command Prompt or PowerShell window and type these in:
    ```bash
    node -v
    npm -v
    ```
    You should see the versions pop up if it's all good!

### Node.js for Linux

For Linux, `nvm` (Node Version Manager) is a brilliant way to install Node.js. It lets you easily swap between different Node.js versions.

1.  **Install `nvm`:**
    ```bash
    curl -o- [https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh](https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh) | bash
    ```
    (Just double-check `v0.39.1` is the latest `nvm` version on their GitHub page, and update it if needed!).
    Once it's done, close and reopen your terminal. If that doesn't work, try `source ~/.bashrc` (or `~/.zshrc` for Zsh users).
2.  **Install Node.js (LTS):**
    ```bash
    nvm install --lts
    nvm use --lts
    ```
3.  **Check It Out:**
    ```bash
    node -v
    npm -v
    ```
    You should see your installed versions here!
4.  **Install `unzip` (if you don't have it):**
    * **Debian/Ubuntu:** `sudo apt update && sudo apt install unzip`
    * **CentOS/RHEL/Fedora:** `sudo yum install unzip` or `sudo dnf install unzip`

---

## 3. App Prep

1.  **Get the Files:** Either clone the Git repository or just download the ZIP file.
    ```bash
    git clone <repository-url>
    cd minecraft-bedrock-server-manager # Or whatever you named the folder
    ```
2.  **Install the Bits:** Hop into the project folder in your terminal and run this to get all the necessary bits:
    ```bash
    npm install
    ```
3.  **Set Up Server Paths:**
    * Open up the `minecraft_bedrock_installer_nodejs.js` file.
    * Find the `init()` function. You'll see where the app expects your server files (`SERVER_DIRECTORY`), temporary downloads (`TEMP_DIRECTORY`), and backups (`BACKUP_DIRECTORY`) to live. Feel free to change these if you like!
        * **Windows example:** `C:\MinecraftBedrockServer\server`
        * **Linux example:** `/opt/bedrock/server`
    * Also, make sure `MC_USER` and `MC_GROUP` in that same file match the user and group that'll own your Minecraft server files on Linux.

4.  **First-Time Server Setup (Totally Recommended!):**
    * If you haven't got a Minecraft Bedrock server chilling at your `SERVER_DIRECTORY` yet, no worries! Once you start this app, you can just hit the "Check & Install Update" button in the web interface. It'll download and set up the latest server for you!

---

## 4. Let's Get This Party Started!

1.  **Go to the Folder:** Open your terminal or command prompt and navigate to where you put the app files.
2.  **Fire It Up!**
    ```bash
    node app.js
    ```
3.  **Open in Your Browser:** Pop open your web browser and go to:
    ```
    http://localhost:3000
    ```
    (If something else is using port 3000, the app might tell you it's running on a different one, or you can just change it in `app.js`).

---

## 5. How to Use It

Once your app is up and running and you're looking at the web page, you'll see a few handy sections:

### Server Buttons

* **Server Status:** This just tells you if your Minecraft server is `running` or `stopped`. Simple as that!
* **Start Server:** Kicks off your Minecraft Bedrock server.
* **Stop Server:** Shuts down your Minecraft Bedrock server.
* **Restart Server:** Stops your server, then starts it back up again. Handy for applying changes!
* **Check & Install Update:** This button is neat! It peeks at the official Minecraft website to see if there's a newer server version. If there is, it'll:
    1.  Pause your current server.
    2.  Make a quick backup of your old server stuff (worlds, `server.properties`, all that good stuff!).
    3.  Download and unpack the shiny new server files.
    4.  Copy your old worlds and `server.properties` into the new setup.
    5.  Bring the updated server back online!

### Auto-Update Fun

This section lets you decide if you want the app to handle updates automatically.

* **Enable Automatic Updates:** Tick this box if you want the app to check for updates all on its own.
* **Update Check Interval (minutes):** Here, you can tell the app how often (in minutes) to look for new server versions.
* **Save Auto-Update Settings:** Hit this to save your choices. The auto-update magic will kick in right away with your new settings!

### Server Settings

This is where you can peek at and change your `server.properties` file.

* **Tweak Values:** Just type in the new values next to each setting.
* **Save Properties:** Click this to save your changes to the `server.properties` file. **Heads up:** For most of these changes to actually do anything, you'll need to hit that "Restart Server" button in the "Server Buttons" section!

### World Magic

This section shows you all the worlds you have in your Minecraft server's `worlds` folder.

* **World List:** See all your worlds listed here! The one currently being used by your server will be highlighted.
* **Activate Button:** Click this next to a world's name to make it the active world in your `server.properties` file. **Don't forget to click "Save Properties" after picking a new world, and then restart your server to load it up!**

Have a blast managing your Minecraft Bedrock Server!
