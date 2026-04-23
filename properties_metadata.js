/**
 * User-friendly metadata for Minecraft Bedrock server properties.
 * Maps raw property keys to human-readable labels, categories, and UI types.
 */

export const categories = [
    { id: 'general', label: 'General' },
    { id: 'gameplay', label: 'Gameplay' },
    { id: 'performance', label: 'Performance' },
    { id: 'security', label: 'Security' },
    { id: 'advanced', label: 'Advanced' }
];

export const propertiesMetadata = {
    'server-name': {
        label: 'Server Name',
        category: 'general',
        description: 'The name of your server as it appears in the server list.',
        type: 'string'
    },
    'level-name': {
        label: 'World Name',
        category: 'general',
        description: 'The name of the level directory. Each level has its own folder in worlds/.',
        type: 'string'
    },
    'level-seed': {
        label: 'World Seed',
        category: 'general',
        description: 'The seed to be used for randomizing the world. Leave empty for a random seed.',
        type: 'string'
    },
    'server-port': {
        label: 'IPv4 Port',
        category: 'general',
        description: 'Which IPv4 port the server should listen to.',
        type: 'number',
        min: 1,
        max: 65535
    },
    'server-portv6': {
        label: 'IPv6 Port',
        category: 'general',
        description: 'Which IPv6 port the server should listen to.',
        type: 'number',
        min: 1,
        max: 65535
    },
    'online-mode': {
        label: 'Online Mode',
        category: 'security',
        description: 'If true, all connected players must be authenticated to Xbox Live.',
        type: 'boolean'
    },
    'allow-list': {
        label: 'Allow List',
        category: 'security',
        description: 'If true, all connected players must be listed in allowlist.json.',
        type: 'boolean'
    },
    'white-list': {
        label: 'White List (Legacy)',
        category: 'security',
        description: 'Legacy version of allow-list.',
        type: 'boolean'
    },
    'gamemode': {
        label: 'Default Game Mode',
        category: 'gameplay',
        description: 'Sets the game mode for new players.',
        type: 'select',
        options: ['survival', 'creative', 'adventure']
    },
    'force-gamemode': {
        label: 'Force Game Mode',
        category: 'gameplay',
        description: 'Forces the set game mode even if the player has a different one saved.',
        type: 'boolean'
    },
    'difficulty': {
        label: 'Difficulty',
        category: 'gameplay',
        description: 'Sets the difficulty of the world.',
        type: 'select',
        options: ['peaceful', 'easy', 'normal', 'hard']
    },
    'allow-cheats': {
        label: 'Allow Cheats',
        category: 'gameplay',
        description: 'If true, cheat commands can be used.',
        type: 'boolean'
    },
    'max-players': {
        label: 'Max Players',
        category: 'general',
        description: 'The maximum number of players that can play on the server.',
        type: 'number',
        min: 1
    },
    'pvp': {
        label: 'Enable PvP',
        category: 'gameplay',
        description: 'If enabled, players can damage each other.',
        type: 'boolean'
    },
    'hardcore': {
        label: 'Hardcore Mode',
        category: 'gameplay',
        description: 'If enabled, players have only one life.',
        type: 'boolean'
    },
    'default-player-permission-level': {
        label: 'Default Permission Level',
        category: 'gameplay',
        description: 'Permission level for new players joining for the first time.',
        type: 'select',
        options: ['visitor', 'member', 'operator']
    },
    'view-distance': {
        label: 'View Distance',
        category: 'performance',
        description: 'The maximum allowed view distance in chunks.',
        type: 'number',
        min: 5
    },
    'tick-distance': {
        label: 'Tick Distance',
        category: 'performance',
        description: 'How many chunks away from a player should be updated.',
        type: 'number',
        min: 4,
        max: 12
    },
    'max-threads': {
        label: 'Max Threads',
        category: 'performance',
        description: 'Maximum number of threads the server will try to use.',
        type: 'number',
        min: 0
    },
    'texturepack-required': {
        label: 'Require Texture Pack',
        category: 'gameplay',
        description: 'Forces clients to use server texture packs.',
        type: 'boolean'
    },
    'content-log-file-enabled': {
        label: 'Enable Content Log',
        category: 'advanced',
        description: 'Enables logging content errors to a file.',
        type: 'boolean'
    },
    'compression-algorithm': {
        label: 'Compression Algorithm',
        category: 'performance',
        description: 'The compression algorithm to use for networking.',
        type: 'select',
        options: ['zlib', 'snappy']
    },
    'server-authoritative-movement': {
        label: 'Authoritative Movement',
        category: 'security',
        description: 'Determines the authority for player movement.',
        type: 'select',
        options: ['client-auth', 'server-auth', 'server-auth-with-rewind']
    },
    'correct-player-movement': {
        label: 'Correct Player Movement',
        category: 'security',
        description: 'Whether to correct player movement if it deviates too much.',
        type: 'boolean'
    },
    'allow-spectators': {
        label: 'Allow Spectators',
        category: 'gameplay',
        description: 'Whether players can join in spectator mode.',
        type: 'boolean'
    },
    'chat-restriction': {
        label: 'Chat Restriction',
        category: 'security',
        description: 'Restriction applied to the chat.',
        type: 'select',
        options: ['None', 'Dropped', 'Disabled']
    },
    'disable-player-interaction': {
        label: 'Disable Player Interaction',
        category: 'gameplay',
        description: 'If true, players ignore each other when interacting with the world.',
        type: 'boolean'
    },
    'disable-custom-skins': {
        label: 'Disable Custom Skins',
        category: 'security',
        description: 'Disables skins customized outside of the store assets.',
        type: 'boolean'
    },
    'emit-server-telemetry': {
        label: 'Emit Server Telemetry',
        category: 'advanced',
        description: 'If true, enables the server to emit telemetry events.',
        type: 'boolean'
    },
    'compression-threshold': {
        label: 'Compression Threshold',
        category: 'performance',
        description: 'Determines the smallest packet size to compress.',
        type: 'number',
        min: 0,
        max: 65535
    },
    'player-movement-score-threshold': {
        label: 'Movement Score Threshold',
        category: 'security',
        description: 'Threshold for movement-related corrections.',
        type: 'number',
        min: 0
    },
    'player-movement-distance-threshold': {
        label: 'Movement Distance Threshold',
        category: 'security',
        description: 'Max allowed distance between client and server positions.',
        type: 'number',
        min: 0
    },
    'player-movement-duration-threshold-in-ms': {
        label: 'Movement Duration Threshold (ms)',
        category: 'security',
        description: 'Max time allowed before movement correction is triggered.',
        type: 'number',
        min: 0
    }
};
