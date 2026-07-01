require('dotenv').config();
const fs = require('fs'); 
const http = require('http'); 
const { createWorker } = require('tesseract.js'); 

const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} = require('discord.js');

// ==========================================
// RENDER DUMMY SERVER
// ==========================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('PUBG Danger Bot është ONLINE!\n');
}).listen(PORT, () => {
    console.log("🚀 [RENDER] Serveri dummy po dëgjon");
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers 
    ]
});

const PREFIX = '!';
const SLOTS_CHANNEL_ID = process.env.SLOTS_CHANNEL_ID; 
const MAP_VOTING_CHANNEL_ID = process.env.MAP_VOTING_CHANNEL_ID; 
const RESULTS_CHANNEL_ID = process.env.RESULTS_CHANNEL_ID; 
const DATA_FILE = './ekipet.json'; 

const AVAILABLE_MAPS = ['Erangel', 'Miramar', 'Sanhok', 'Vikendi', 'Taego', 'Rondo'];

const TOURNAMENT_DATA = {
    reg_open: false,
    checkin_open: false,
    max_slots: 25,          
    teams: new Map(),      
    checked_in: new Set(),
    slots_msg_id: null,
    reg_msg_id: null,       
    reg_channel_id: null,
    maps_voting_open: false,
    maps_msg_id: null,
    map_votes: {},
    top_players: {}, 
    day: 1,
    game: 1,
    players_alive: 0,
    match_status: 'Starting', 
    kill_list: [],
    live_msg_id: null,       
    live_channel_id: null    
};

function getPlacementPoints(rank) {
    if (rank === 1) return 10;
    if (rank === 2) return 6;
    if (rank === 3) return 5;
    if (rank === 4) return 4;
    if (rank === 5) return 3;
    if (rank === 6) return 2;
    if (rank === 7 || rank === 8) return 1;
    return 0; 
}

// ==========================================
// FUNKSIONET PËR RUAJTJEN DHE LEXIMIN
// ==========================================
function loadTournamentData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const rawData = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(rawData);
            
            TOURNAMENT_DATA.reg_open = parsed.reg_open || false;
            TOURNAMENT_DATA.checkin_open = parsed.checkin_open || false;
            TOURNAMENT_DATA.max_slots = parsed.max_slots || 25;
            TOURNAMENT_DATA.slots_msg_id = parsed.slots_msg_id || null;
            TOURNAMENT_DATA.reg_msg_id = parsed.reg_msg_id || null;
            TOURNAMENT_DATA.reg_channel_id = parsed.reg_channel_id || null;
            TOURNAMENT_DATA.maps_voting_open = parsed.maps_voting_open || false;
            TOURNAMENT_DATA.maps_msg_id = parsed.maps_msg_id || null;
            TOURNAMENT_DATA.map_votes = parsed.map_votes || {};
            TOURNAMENT_DATA.top_players = parsed.top_players || {};
            
            TOURNAMENT_DATA.day = parsed.day || 1;
            TOURNAMENT_DATA.game = parsed.game || 1;
            TOURNAMENT_DATA.players_alive = parsed.players_alive !== undefined ? parsed.players_alive : 0;
            TOURNAMENT_DATA.match_status = parsed.match_status || 'Starting';
            TOURNAMENT_DATA.kill_list = parsed.kill_list || [];
            TOURNAMENT_DATA.live_msg_id = parsed.live_msg_id || null;
            TOURNAMENT_DATA.live_channel_id = parsed.live_channel_id || null;
            
            TOURNAMENT_DATA.teams = new Map(Object.entries(parsed.teams || {}));
            TOURNAMENT_DATA.checked_in = new Set(parsed.checked_in || []);
        } catch (error) { console.error(error); }
    }
}

function saveTournamentData() {
    try {
        const dataToSave = {
            reg_open: TOURNAMENT_DATA.reg_open,
            checkin_open: TOURNAMENT_DATA.checkin_open,
            max_slots: TOURNAMENT_DATA.max_slots,
            slots_msg_id: TOURNAMENT_DATA.slots_msg_id,
            reg_msg_id: TOURNAMENT_DATA.reg_msg_id,
            reg_channel_id: TOURNAMENT_DATA.reg_channel_id,
            maps_voting_open: TOURNAMENT_DATA.maps_voting_open,
            maps_msg_id: TOURNAMENT_DATA.maps_msg_id,
            map_votes: TOURNAMENT_DATA.map_votes,
            top_players: TOURNAMENT_DATA.top_players,
            day: TOURNAMENT_DATA.day,
            game: TOURNAMENT_DATA.game,
            players_alive: TOURNAMENT_DATA.players_alive,
            match_status: TOURNAMENT_DATA.match_status,
            kill_list: TOURNAMENT_DATA.kill_list,
            live_msg_id: TOURNAMENT_DATA.live_msg_id,
            live_channel_id: TOURNAMENT_DATA.live_channel_id,
            teams: Object.fromEntries(TOURNAMENT_DATA.teams), 
            checked_in: Array.from(TOURNAMENT_DATA.checked_in) 
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 4), 'utf8');
    } catch (error) { console.error(error); }
}

async function updateLiveMatchDisplay(channel) {
    const formatKills = TOURNAMENT_DATA.kill_list.length > 0 
        ? TOURNAMENT_DATA.kill_list.join('\n') 
        : '-';

    let statusEmoji = '⏳';
    if (TOURNAMENT_DATA.match_status === 'Live') statusEmoji = '🔴';
    if (TOURNAMENT_DATA.match_status === 'Finished') statusEmoji = '🏁';

    const embed = new EmbedBuilder()
        .setTitle('🎮 DANGER ESPORTS — LIVE TRACKER')
        .setDescription(`**Day:** ${TOURNAMENT_DATA.day}\n**Game:** ${TOURNAMENT_DATA.game}\n\n**Players Alive:** ${TOURNAMENT_DATA.players_alive}\n**Status:** ${statusEmoji} ${TOURNAMENT_DATA.match_status}\n\n**Kills:**\n${formatKills}`)
        .setColor('#FF5500')
        .setTimestamp();

    if (TOURNAMENT_DATA.live_msg_id && TOURNAMENT_DATA.live_channel_id) {
        try {
            const targetChannel = await client.channels.fetch(TOURNAMENT_DATA.live_channel_id);
            const existingMsg = await targetChannel.messages.fetch(TOURNAMENT_DATA.live_msg_id);
            await existingMsg.edit({ embeds: [embed] });
            return; 
        } catch (err) {}
    }

    try {
        const fetchedMessages = await channel.messages.fetch({ limit: 15 });
        const oldTracker = fetchedMessages.find(msg => 
            msg.author.id === client.user.id && 
            msg.embeds.length > 0 && 
            msg.embeds[0].title && 
            msg.embeds[0].title.includes('LIVE TRACKER')
        );

        if (oldTracker) {
            await oldTracker.edit({ embeds: [embed] });
            TOURNAMENT_DATA.live_msg_id = oldTracker.id;
            TOURNAMENT_DATA.live_channel_id = channel.id;
            saveTournamentData();
            return;
        }
    } catch (scanErr) {
        console.error("Gabim gjatë skanimit të mesazheve:", scanErr);
    }

    const newMsg = await channel.send({ embeds: [embed] });
    TOURNAMENT_DATA.live_msg_id = newMsg.id;
    TOURNAMENT_DATA.live_channel_id = channel.id;
    saveTournamentData();
}

function generateSlotsList() {
    let lines = [];
    const teamNames = Array.from(TOURNAMENT_DATA.teams.keys());
    for (let i = 0; i < TOURNAMENT_DATA.max_slots; i++) {
        if (i < teamNames.length) {
            const teamName = teamNames[i];
            lines.push(`slot ${i + 1}: **${teamName}** | status: ${TOURNAMENT_DATA.checked_in.has(teamName) ? "check in ✔️" : "not check in ⏱️"}`);
        } else { lines.push(`slot ${i + 1}: *I lirë / Empty*`); }
    }
    return lines.join('\n');
}

function getSlotStatus() { return `Slotet: ${TOURNAMENT_DATA.teams.size}/${TOURNAMENT_DATA.max_slots}`; }

function getRegistrationComponents() { 
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('reg_team_btn').setLabel('Regjistro Ekipin').setStyle(ButtonStyle.Success), 
        new ButtonBuilder().setCustomId('edit_team_btn').setLabel('Edito Ekipin').setStyle(ButtonStyle.Secondary)
    );
    
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('view_teams_btn').setLabel('Shiko Ekipet').setStyle(ButtonStyle.Primary), 
        new ButtonBuilder().setCustomId('cancel_reg_btn').setLabel('Anulo Regjistrimin').setStyle(ButtonStyle.Danger)
    );

    return [row1, row2];
}

async function updateSlotsDisplay() {
    if (!SLOTS_CHANNEL_ID) return;
    const embed = new EmbedBuilder().setTitle('🏆 Tabela Zyrtare e Sloteve (LIVE)').setDescription(generateSlotsList()).setColor('#0099ff');
    try {
        const targetChannel = await client.channels.fetch(SLOTS_CHANNEL_ID);
        if (TOURNAMENT_DATA.slots_msg_id) {
            try { const existingMsg = await targetChannel.messages.fetch(TOURNAMENT_DATA.slots_msg_id); await existingMsg.edit({ embeds: [embed] }); return; } catch (err) {}
        }
        const newMsg = await targetChannel.send({ embeds: [embed] });
        TOURNAMENT_DATA.slots_msg_id = newMsg.id;
        saveTournamentData(); 
    } catch (error) { console.error(error); }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (!message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ==========================================
    // KOMANDAT: OPENLIVE, CLOSELIVE & DELETELIVE
    // ==========================================

    if (command === 'openlive') {
        await message.delete().catch(() => {});
        
        if (TOURNAMENT_DATA.live_msg_id && TOURNAMENT_DATA.live_channel_id) {
            try {
                const oldChannel = await client.channels.fetch(TOURNAMENT_DATA.live_channel_id);
                const oldMsg = await oldChannel.messages.fetch(TOURNAMENT_DATA.live_msg_id);
                await oldMsg.delete().catch(() => {});
            } catch (err) {}
        }

        TOURNAMENT_DATA.live_msg_id = null;
        TOURNAMENT_DATA.live_channel_id = null;
        saveTournamentData();

        await updateLiveMatchDisplay(message.channel);

        const confirmOpen = await message.channel.send("✅ **Live Tracker u hap me sukses në kët' kanal!**");
        setTimeout(() => confirmOpen.delete().catch(() => {}), 3000);
        return;
    }

    if (command === 'closelive') {
        await message.delete().catch(() => {});

        if (TOURNAMENT_DATA.live_msg_id && TOURNAMENT_DATA.live_channel_id) {
            try {
                const oldChannel = await client.channels.fetch(TOURNAMENT_DATA.live_channel_id);
                const oldMsg = await oldChannel.messages.fetch(TOURNAMENT_DATA.live_msg_id);
                await oldMsg.delete().catch(() => {});
            } catch (err) {}
        }

        TOURNAMENT_DATA.live_msg_id = null;
        TOURNAMENT_DATA.live_channel_id = null;
        saveTournamentData();

        const confirmClose = await message.channel.send("🛑 **Live Tracker u mbyll dhe mesazhi u fshi plotësisht!**");
        setTimeout(() => confirmClose.delete().catch(() => {}), 3000);
        return;
    }

    if (command === 'deletelive') {
        await message.delete().catch(() => {});

        try {
            const fetchedMessages = await message.channel.messages.fetch({ limit: 50 });
            const trackerMessages = fetchedMessages.filter(msg => 
                msg.author.id === client.user.id && 
                msg.embeds.length > 0 && 
                msg.embeds[0].title && 
                msg.embeds[0].title.includes('LIVE TRACKER')
            );

            for (const msg of trackerMessages.values()) {
                await msg.delete().catch(() => {});
            }
        } catch (error) {
            console.error("Gabim gjatë fshirjes së embed-eve të vjetra:", error);
        }

        TOURNAMENT_DATA.live_msg_id = null;
        TOURNAMENT_DATA.live_channel_id = null;
        saveTournamentData();

        const confirmDelete = await message.channel.send("🧹 **U fshinë me rrënjë të gjitha Embed-et e Live Tracker në këtë kanal!**");
        setTimeout(() => confirmDelete.delete().catch(() => {}), 3000);
        return;
    }

    // ==========================================
    // KOMANDAT LIVE TRACKER (MANUALE)
    // ==========================================
    
    if (command === 'day') {
        const dayNum = parseInt(args[0]);
        if (isNaN(dayNum)) return message.reply('⚠️ Përdorimi: `!day 1`');
        await message.delete().catch(() => {}); 
        TOURNAMENT_DATA.day = dayNum;
        saveTournamentData();
        return updateLiveMatchDisplay(message.channel);
    }

    if (command === 'game') {
        const gameNum = parseInt(args[0]);
        if (isNaN(gameNum)) return message.reply('⚠️ Përdorimi: `!game 2`');
        await message.delete().catch(() => {});
        TOURNAMENT_DATA.game = gameNum;
        TOURNAMENT_DATA.kill_list = []; 
        TOURNAMENT_DATA.match_status = 'Starting'; 
        saveTournamentData();
        return updateLiveMatchDisplay(message.channel);
    }

    if (command === 'playersalive' || command === 'aliveplayer') {
        const aliveNum = parseInt(args[0]);
        if (isNaN(aliveNum)) return message.reply('⚠️ Përdorimi: `!playersalive 90`');
        await message.delete().catch(() => {});
        TOURNAMENT_DATA.players_alive = aliveNum;
        saveTournamentData();
        return updateLiveMatchDisplay(message.channel);
    }

    if (command === 'status') {
        const statusInput = args[0]?.toLowerCase();
        if (!statusInput || !['starting', 'live', 'finished'].includes(statusInput)) {
            return message.reply('⚠️ Përdorimi: `!status starting` ose `!status live` ose `!status finished`');
        }
        await message.delete().catch(() => {});
        
        if (statusInput === 'finished' && TOURNAMENT_DATA.match_status !== 'Finished') {
            if (!TOURNAMENT_DATA.top_players) TOURNAMENT_DATA.top_players = {};
            
            TOURNAMENT_DATA.kill_list.forEach(entry => {
                if (entry.includes(' killed ')) {
                    const killer = entry.split(' killed ')[0].trim();
                    if (killer) {
                        TOURNAMENT_DATA.top_players[killer] = (TOURNAMENT_DATA.top_players[killer] || 0) + 1;
                    }
                }
            });
        }

        TOURNAMENT_DATA.match_status = statusInput.charAt(0).toUpperCase() + statusInput.slice(1);
        saveTournamentData();
        return updateLiveMatchDisplay(message.channel);
    }

    if (command === 'kill') {
        const fullText = args.join(' ');
        const parts = fullText.split(/\s+vs\s+/i);
        
        if (parts.length !== 2) {
            return message.reply('⚠️ Përdorimi: `!kill Player1 vs Player2`');
        }

        await message.delete().catch(() => {});
        const player1 = parts[0].trim();
        const player2 = parts[1].trim();

        if (TOURNAMENT_DATA.players_alive > 0) {
            TOURNAMENT_DATA.players_alive -= 1;
        }

        TOURNAMENT_DATA.kill_list.push(`${player1} killed ${player2}.`);
        saveTournamentData();
        
        return updateLiveMatchDisplay(message.channel);
    }

    if (command === 'resetlive') {
        await message.delete().catch(() => {});
        
        if (TOURNAMENT_DATA.live_msg_id && TOURNAMENT_DATA.live_channel_id) {
            try {
                const oldChannel = await client.channels.fetch(TOURNAMENT_DATA.live_channel_id);
                const oldMsg = await oldChannel.messages.fetch(TOURNAMENT_DATA.live_msg_id);
                await oldMsg.delete().catch(() => {});
            } catch (err) {}
        }

        TOURNAMENT_DATA.day = 1;
        TOURNAMENT_DATA.game = 1;
        TOURNAMENT_DATA.players_alive = 0;
        TOURNAMENT_DATA.match_status = 'Starting';
        TOURNAMENT_DATA.kill_list = [];
        TOURNAMENT_DATA.live_msg_id = null;       
        TOURNAMENT_DATA.live_channel_id = null;
        
        saveTournamentData();
        await updateLiveMatchDisplay(message.channel);
        
        const resetMsg = await message.channel.send("🔄 **Live Tracker u bë reset!**");
        setTimeout(() => resetMsg.delete().catch(() => {}), 3000);
        return;
    }

    // ==========================================
    // TOP 5 PLAYERS & STATS
    // ==========================================

    if (command === 'top') {
        const playersArray = Object.entries(TOURNAMENT_DATA.top_players || {});
        if (playersArray.length === 0) {
            return message.reply("❌ Nuk ka asnjë të dhënë për lojtarët në TOP për momentin.");
        }

        const sortedPlayers = playersArray.sort((a, b) => b[1] - a[1]).slice(0, 5);
        let descLines = [];

        sortedPlayers.forEach(([name, kills], index) => {
            let medal = index === 0 ? "👑" : index === 1 ? "🥈" : index === 2 ? "🥉" : "🎯";
            descLines.push(`${medal} **#${index + 1}** Lojtari: **${name}** — 🎯 **${kills} Kills**`);
        });

        const topEmbed = new EmbedBuilder()
            .setTitle('👑 DANGER ESPORTS — TOP 5 LOJTARËT MË VRASËS')
            .setDescription(descLines.join('\n\n'))
            .setColor('#00FFCC')
            .setTimestamp();

        return message.channel.send({ embeds: [topEmbed] });
    }

    if (command === 'stats') {
        let targetName = args.join(' ').trim();
        let foundPlayerKey = null;
        let associatedTeam = null;

        if (!targetName) {
            const authorTag = `<@${message.author.id}>`;
            const authorTagAlt = `<@!${message.author.id}>`;
            
            for (const [tName, tData] of TOURNAMENT_DATA.teams.entries()) {
                for (const p of tData.players) {
                    if (p.includes(authorTag) || p.includes(authorTagAlt) || p.toLowerCase() === message.author.username.toLowerCase()) {
                        foundPlayerKey = p;
                        associatedTeam = tData;
                        break;
                    }
                }
                if (foundPlayerKey) break;
            }
            if (!foundPlayerKey) {
                targetName = message.author.username;
            }
        }

        if (targetName && !foundPlayerKey) {
            const exactKey = Object.keys(TOURNAMENT_DATA.top_players).find(k => k.toLowerCase() === targetName.toLowerCase());
            if (exactKey) {
                foundPlayerKey = exactKey;
                for (const [tName, tData] of TOURNAMENT_DATA.teams.entries()) {
                    if (tData.players.some(p => p.toLowerCase().includes(targetName.toLowerCase()))) {
                        associatedTeam = tData;
                        break;
                    }
                }
            } else {
                for (const [tName, tData] of TOURNAMENT_DATA.teams.entries()) {
                    for (const p of tData.players) {
                        if (p.toLowerCase().includes(targetName.toLowerCase())) {
                            foundPlayerKey = p;
                            associatedTeam = tData;
                            break;
                        }
                    }
                    if (foundPlayerKey) break;
                }
            }
        }

        if (!foundPlayerKey) {
            foundPlayerKey = targetName || message.author.username;
        }

        let cleanName = foundPlayerKey.replace(/<@!?\d+>/g, '').replace(/@\S+/g, '').trim();
        if (!cleanName) cleanName = foundPlayerKey; 

        let totalKills = 0;
        if (TOURNAMENT_DATA.top_players[cleanName] !== undefined) {
            totalKills = TOURNAMENT_DATA.top_players[cleanName];
        } else if (TOURNAMENT_DATA.top_players[foundPlayerKey] !== undefined) {
            totalKills = TOURNAMENT_DATA.top_players[foundPlayerKey];
        }

        let gamesPlayed = associatedTeam ? (associatedTeam.matches || 0) : 0;
        let wins = associatedTeam ? (associatedTeam.wins || 0) : 0;

        const sortedPlayers = Object.entries(TOURNAMENT_DATA.top_players).sort((a, b) => b[1] - a[1]);
        let currentRank = "N/A";
        const rankIndex = sortedPlayers.findIndex(([name]) => name.toLowerCase() === cleanName.toLowerCase() || name.toLowerCase() === foundPlayerKey.toLowerCase());
        
        if (rankIndex !== -1) {
            currentRank = `#${rankIndex + 1}`;
        } else if (totalKills > 0) {
            currentRank = `#${sortedPlayers.length + 1}`;
        }

        const statsEmbed = new EmbedBuilder()
            .setTitle('📊 Player Stats')
            .setDescription(
                `👤 **Player:** ${cleanName}\n\n` +
                `☠️ **Total Kills:** ${totalKills}\n` +
                `🎮 **Games Played:** ${gamesPlayed}\n` +
                `🏆 **Wins:** ${wins}\n\n` +
                `🏅 **Current Rank:** ${currentRank}`
            )
            .setColor('#00FFCC')
            .setTimestamp();

        return message.channel.send({ embeds: [statsEmbed] });
    }

    if (command === 'edittop') {
        if (args.length < 2) {
            return message.reply('⚠️ **Përdorimi:** `!edittop <Emri_Lojtarit> <Kills>`\nShembull: `!edittop DangerKing 15`');
        }

        const killsInput = parseInt(args[args.length - 1]);
        const playerName = args.slice(0, args.length - 1).join(' ').trim();

        if (isNaN(killsInput)) {
            return message.reply('❌ Gabim! Numri i kills duhet të jetë një numër i saktë.');
        }

        if (!TOURNAMENT_DATA.top_players) TOURNAMENT_DATA.top_players = {};
        
        TOURNAMENT_DATA.top_players[playerName] = killsInput;
        saveTournamentData();

        return message.reply(`✅ **Përditësim Manual:** Lojtari **${playerName}** u vendos në **${killsInput} Kills**.`);
    }

    if (command === 'resettop') {
        TOURNAMENT_DATA.top_players = {};
        saveTournamentData();
        return message.reply('🔄 **Tabela e Top Lojtarëve u fshi! Të gjithë lojtarët u bënë 0 killa.**');
    }

    if (command === 'register' && args[0] === 'open') {
        TOURNAMENT_DATA.reg_open = true;
        const embed = new EmbedBuilder()
            .setTitle('🎮 Regjistrimi është i HAPUR')
            .setDescription(`**Statusi:** 🟢 Duke pranuar ekipe\n\n${getSlotStatus()}`)
            .setColor('#00FF00');
        
        await message.channel.send({ embeds: [embed], components: getRegistrationComponents() });
    }

    // ==========================================
    // KOMANDAT E VOTIMIT TË MAP-EVE
    // ==========================================
    if (command === 'postmaps') {
        await message.delete().catch(() => {});
        
        TOURNAMENT_DATA.maps_voting_open = true;
        TOURNAMENT_DATA.map_votes = {}; 
        
        AVAILABLE_MAPS.forEach(map => {
            TOURNAMENT_DATA.map_votes[map] = []; 
        });
        saveTournamentData();

        const embed = new EmbedBuilder()
            .setTitle('🗺️ VOTIMI PËR MAP-IN ZYRTAR')
            .setDescription('Secili lojtar ka të drejtë të japë **deri në 3 vota** për map-e të ndryshme.\nKliko përsëri mbi map-in nëse dëshiron t\'i heqësh votën!\n\n' + 
                             AVAILABLE_MAPS.map(map => `📍 **${map}**: 0 vota`).join('\n'))
            .setColor('#FFAA00')
            .setTimestamp();

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vote_map_Erangel').setLabel('Erangel').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('vote_map_Miramar').setLabel('Miramar').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('vote_map_Sanhok').setLabel('Sanhok').setStyle(ButtonStyle.Primary)
        );
        
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vote_map_Vikendi').setLabel('Vikendi').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('vote_map_Taego').setLabel('Taego').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('vote_map_Rondo').setLabel('Rondo').setStyle(ButtonStyle.Primary)
        );

        const votingMsg = await message.channel.send({ embeds: [embed], components: [row1, row2] });
        TOURNAMENT_DATA.maps_msg_id = votingMsg.id;
        saveTournamentData();
    }

    // 1. !MAPSRESULTS - SHFAQ VOTAT E TANIYSHME
    if (command === 'mapsresults') {
        await message.delete().catch(() => {});
        
        if (!TOURNAMENT_DATA.map_votes) TOURNAMENT_DATA.map_votes = {};
        const lines = AVAILABLE_MAPS.map(m => {
            const count = TOURNAMENT_DATA.map_votes[m] ? TOURNAMENT_DATA.map_votes[m].length : 0;
            return `📍 **${m}**: ${count} vota`;
        });

        const embed = new EmbedBuilder()
            .setTitle('📊 REZULTATET AKTUALE TË VOTIMIT TË MAP-EVE')
            .setDescription(lines.join('\n'))
            .setColor('#00FFCC')
            .setTimestamp();

        return message.channel.send({ embeds: [embed] });
    }

    // 2. !CLOSEMAPS - MBYLL VOTIMIN DHE SHPALL FITUESIN
    if (command === 'closemaps') {
        await message.delete().catch(() => {});
        
        TOURNAMENT_DATA.maps_voting_open = false;
        saveTournamentData();

        let winnerMap = 'Asnjë map (Ska vota)';
        let maxVotes = -1;
        
        AVAILABLE_MAPS.forEach(m => {
            const count = TOURNAMENT_DATA.map_votes[m] ? TOURNAMENT_DATA.map_votes[m].length : 0;
            if (count > maxVotes && count > 0) {
                maxVotes = count;
                winnerMap = m;
            }
        });

        const embed = new EmbedBuilder()
            .setTitle('🛑 VOTIMI I MAP-EVE U MBYLL')
            .setDescription(`Votimi u mbyll zyrtarisht nga administratori!\n\n🏆 Map-i zyrtar i përzgjedhur: **${winnerMap}** ${maxVotes !== -1 ? `(${maxVotes} vota)` : ''}`)
            .setColor('#FF0000')
            .setTimestamp();

        return message.channel.send({ embeds: [embed] });
    }

    // 3. !RESETMAPS - FSHIN TË GJITHA VOTAT
    if (command === 'resetmaps') {
        await message.delete().catch(() => {});
        
        TOURNAMENT_DATA.map_votes = {};
        AVAILABLE_MAPS.forEach(map => {
            TOURNAMENT_DATA.map_votes[map] = [];
        });
        TOURNAMENT_DATA.maps_voting_open = false;
        TOURNAMENT_DATA.maps_msg_id = null;
        saveTournamentData();

        const resetMsg = await message.channel.send("🔄 **Të gjitha votat e map-eve u fshinë dhe votimi u mbyll!**");
        setTimeout(() => resetMsg.delete().catch(() => {}), 4000);
        return;
    }
});

// ==========================================
// INTERAKSIONET (BUTONAT / MODAL SUBMIT)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    // LOGJIKA PËR MAX 3 VOTA
    if (interaction.isButton() && interaction.customId.startsWith('vote_map_')) {
        if (!TOURNAMENT_DATA.maps_voting_open) {
            return interaction.reply({ content: '❌ Votimi për map-et është mbyllur aktualisht ose nuk ka filluar.', ephemeral: true });
        }

        const mapName = interaction.customId.replace('vote_map_', '');
        const userId = interaction.user.id;

        if (!TOURNAMENT_DATA.map_votes) TOURNAMENT_DATA.map_votes = {};
        AVAILABLE_MAPS.forEach(m => {
            if (!TOURNAMENT_DATA.map_votes[m]) TOURNAMENT_DATA.map_votes[m] = [];
        });

        let currentVotesCount = 0;
        AVAILABLE_MAPS.forEach(m => {
            if (TOURNAMENT_DATA.map_votes[m].includes(userId)) {
                currentVotesCount++;
            }
        });

        const hasVotedThisMap = TOURNAMENT_DATA.map_votes[mapName].includes(userId);

        if (hasVotedThisMap) {
            TOURNAMENT_DATA.map_votes[mapName] = TOURNAMENT_DATA.map_votes[mapName].filter(id => id !== userId);
            saveTournamentData();
            await interaction.reply({ content: `🗑️ E hoqe votën për map-in **${mapName}**.`, ephemeral: true });
        } else {
            if (currentVotesCount >= 3) {
                return interaction.reply({ content: '❌ Ke arritur limitin maksimal prej **3 votash**! Mund të heqësh një votë duke klikuar përsëri mbi map-et që ke përzgjedhur.', ephemeral: true });
            }

            TOURNAMENT_DATA.map_votes[mapName].push(userId);
            saveTournamentData();
            await interaction.reply({ content: `✅ Vota jote për map-in **${mapName}** u regjistrua!`, ephemeral: true });
        }

        try {
            const lines = AVAILABLE_MAPS.map(m => {
                const count = TOURNAMENT_DATA.map_votes[m].length;
                return `📍 **${m}**: ${count} vota`;
            });

            const embed = new EmbedBuilder()
                .setTitle('🗺️ VOTIMI PËR MAP-IN ZYRTAR')
                .setDescription('Secili lojtar ka të drejtë të japë **deri në 3 vota** për map-e të ndryshme.\nKliko përsëri mbi map-in nëse dëshiron t\'i heqësh votën!\n\n' + lines.join('\n'))
                .setColor('#FFAA00')
                .setTimestamp();

            await interaction.message.edit({ embeds: [embed] });
        } catch (err) {
            console.error("Gabim gjatë përditësimit të tabelës së votave:", err);
        }
        return;
    }

    // 1. BUTONI: REGJISTRO EKIPIN
    if (interaction.isButton() && interaction.customId === 'reg_team_btn') {
        if (!TOURNAMENT_DATA.reg_open) return interaction.reply({ content: '❌ Regjistrimet janë të mbyllura aktualisht.', ephemeral: true });
        
        for (const [tName, tData] of TOURNAMENT_DATA.teams.entries()) {
            if (tData.leaderId === interaction.user.id) {
                return interaction.reply({ content: '❌ Ju keni regjistruar tashmë një ekip! Nëse dëshironi ta ndryshoni, klikoni butonin "Edito Ekipin".', ephemeral: true });
            }
        }

        const modal = new ModalBuilder().setCustomId('reg_modal').setTitle('🎮 Regjistrimi i Ekipit');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team_name').setLabel('Emri i Ekipit').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p1').setLabel('Lojtari 1 (@tag dhe emri ne pubg)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p2').setLabel('Lojtari 2 (@tag dhe emri ne pubg)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p3').setLabel('Lojtari 3 (@tag dhe emri ne pubg)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p4').setLabel('Lojtari 4 (@tag dhe emri ne pubg)').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
    }

    // 2. BUTONI: EDITO EKIPIN
    if (interaction.isButton() && interaction.customId === 'edit_team_btn') {
        let userTeamName = null;
        let userTeamData = null;

        for (const [tName, tData] of TOURNAMENT_DATA.teams.entries()) {
            if (tData.leaderId === interaction.user.id) {
                userTeamName = tName;
                userTeamData = tData;
                break;
            }
        }

        if (!userTeamName) {
            return interaction.reply({ content: '❌ Ju nuk keni asnjë ekip të regjistruar në emrin tuaj për ta edituar!', ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId('edit_modal').setTitle('📝 Edito Detajet e Ekipit');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('edit_team_name').setLabel('Emri i Ekipit').setStyle(TextInputStyle.Short).setRequired(true).setValue(userTeamName)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('edit_p1').setLabel('Lojtari 1 (@tag dhe emri ne pubg)').setStyle(TextInputStyle.Short).setRequired(true).setValue(userTeamData.players[0] || '')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('edit_p2').setLabel('Lojtari 2 (@tag dhe emri ne pubg)').setStyle(TextInputStyle.Short).setRequired(true).setValue(userTeamData.players[1] || '')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('edit_p3').setLabel('Lojtari 3 (@tag dhe emri ne pubg)').setStyle(TextInputStyle.Short).setRequired(true).setValue(userTeamData.players[2] || '')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('edit_p4').setLabel('Lojtari 4 (@tag dhe emri ne pubg)').setStyle(TextInputStyle.Short).setRequired(true).setValue(userTeamData.players[3] || ''))
        );
        return interaction.showModal(modal);
    }

    // 3. BUTONI: ANULO REGJISTRIMIN
    if (interaction.isButton() && interaction.customId === 'cancel_reg_btn') {
        let userTeamName = null;
        for (const [tName, tData] of TOURNAMENT_DATA.teams.entries()) {
            if (tData.leaderId === interaction.user.id) {
                userTeamName = tName;
                break;
            }
        }

        if (!userTeamName) {
            return interaction.reply({ content: '❌ Ju nuk keni asnjë ekip të regjistruar në emrin tuaj për ta anuluar!', ephemeral: true });
        }

        TOURNAMENT_DATA.teams.delete(userTeamName);
        TOURNAMENT_DATA.checked_in.delete(userTeamName);
        saveTournamentData();

        await interaction.reply({ content: `🗑️ Regjistrimi i ekipit **${userTeamName}** u anulua me sukses!`, ephemeral: true });
        return updateSlotsDisplay(); 
    }

    // 4. BUTONI: SHIKO EKIPET
    if (interaction.isButton() && interaction.customId === 'view_teams_btn') {
        if (TOURNAMENT_DATA.teams.size === 0) {
            return interaction.reply({ content: '📭 Nuk ka asnjë ekip të regjistruar për momentin.', ephemeral: true });
        }

        let lines = [];
        let index = 1;
        for (const [tName, tData] of TOURNAMENT_DATA.teams.entries()) {
            lines.push(`**${index}. ${tName}**\n👥 Lojtarët: ${tData.players.join(', ')}`);
            index++;
        }

        const teamsEmbed = new EmbedBuilder()
            .setTitle('📋 Ekipet e Regjistruara')
            .setDescription(lines.join('\n\n'))
            .setColor('#00ffcc');

        return interaction.reply({ embeds: [teamsEmbed], ephemeral: true });
    }

    // SUBMIT: REGJISTRO MODAL
    if (interaction.isModalSubmit() && interaction.customId === 'reg_modal') {
        const teamName = interaction.fields.getTextInputValue('team_name').trim();
        const p1 = interaction.fields.getTextInputValue('p1').trim();
        const p2 = interaction.fields.getTextInputValue('p2').trim();
        const p3 = interaction.fields.getTextInputValue('p3').trim();
        const p4 = interaction.fields.getTextInputValue('p4').trim();

        if (TOURNAMENT_DATA.teams.has(teamName)) return interaction.reply({ content: '❌ Ky emër ekipi është i zënë.', ephemeral: true });

        TOURNAMENT_DATA.teams.set(teamName, { 
            leaderId: interaction.user.id, 
            players: [p1, p2, p3, p4],
            matches: 0, wins: 0, place_pts: 0, kill_pts: 0, total_pts: 0 
        });
        saveTournamentData();
        await interaction.reply({ content: `🎉 Ekipi **${teamName}** u regjistrua me sukses!`, ephemeral: true });
        return updateSlotsDisplay();
    }

    // SUBMIT: EDITO MODAL
    if (interaction.isModalSubmit() && interaction.customId === 'edit_modal') {
        const newTeamName = interaction.fields.getTextInputValue('edit_team_name').trim();
        const p1 = interaction.fields.getTextInputValue('edit_p1').trim();
        const p2 = interaction.fields.getTextInputValue('edit_p2').trim();
        const p3 = interaction.fields.getTextInputValue('edit_p3').trim();
        const p4 = interaction.fields.getTextInputValue('edit_p4').trim();

        let oldTeamName = null;
        let currentTeamData = null;

        for (const [tName, tData] of TOURNAMENT_DATA.teams.entries()) {
            if (tData.leaderId === interaction.user.id) {
                oldTeamName = tName;
                currentTeamData = tData;
                break;
            }
        }

        if (!oldTeamName) {
            return interaction.reply({ content: '❌ Gabim! Ekipi juaj nuk u gjet.', ephemeral: true });
        }

        if (newTeamName.toLowerCase() !== oldTeamName.toLowerCase() && TOURNAMENT_DATA.teams.has(newTeamName)) {
            return interaction.reply({ content: '❌ Ky emër i ri ekipi është i zënë nga dikush tjetër.', ephemeral: true });
        }

        currentTeamData.players = [p1, p2, p3, p4];
        
        if (newTeamName !== oldTeamName) {
            TOURNAMENT_DATA.teams.delete(oldTeamName);
            if (TOURNAMENT_DATA.checked_in.has(oldTeamName)) {
                TOURNAMENT_DATA.checked_in.delete(oldTeamName);
                TOURNAMENT_DATA.checked_in.add(newTeamName);
            }
        }
        
        TOURNAMENT_DATA.teams.set(newTeamName, currentTeamData);
        saveTournamentData();

        await interaction.reply({ content: `✅ Ekipi juaj u përditësua me sukses në **${newTeamName}**!`, ephemeral: true });
        return updateSlotsDisplay();
    }
});

client.once('ready', () => { loadTournamentData(); console.log(`✔️ Danger Bot Online!`); });
client.login(process.env.DISCORD_TOKEN);
