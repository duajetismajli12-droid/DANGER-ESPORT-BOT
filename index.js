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
    map_votes: {} 
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
            teams: Object.fromEntries(TOURNAMENT_DATA.teams), 
            checked_in: Array.from(TOURNAMENT_DATA.checked_in) 
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 4), 'utf8');
    } catch (error) { console.error(error); }
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
function getRegistrationRow() { return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('reg_team_btn').setLabel('Regjistro Ekipin').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('view_teams_btn').setLabel('Shiko Ekipet').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('cancel_reg_btn').setLabel('Anulo Regjistrimin').setStyle(ButtonStyle.Danger)); }

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

// ==========================================
// LOGJIKA E SKANIMIT AUTOMATIK TE SCREENSHOT
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (RESULTS_CHANNEL_ID && message.channel.id === RESULTS_CHANNEL_ID && message.attachments.size > 0) {
        const attachment = message.attachments.first();
        
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            const statusMsg = await message.reply("🔄 `Sistemi Danger OCR`: Duke skanuar screenshot-in për rezultate dhe killa individualë...");

            try {
                const worker = await createWorker('eng');
                const { data: { text } } = await worker.recognize(attachment.url);
                await worker.terminate();

                const cleanText = text.toLowerCase();
                let userTeamName = null;
                let teamData = null;

                // 1. Identifikimi i Ekipit
                for (const [name, data] of TOURNAMENT_DATA.teams.entries()) {
                    if (cleanText.includes(name.toLowerCase())) {
                        userTeamName = name;
                        teamData = data;
                        break;
                    }

                    let playerMatch = false;
                    for (const pInput of data.players) {
                        const pubgNameClean = pInput.split('@')[0].replace(/\d+/, '').trim().toLowerCase();
                        if (pubgNameClean.length > 2 && cleanText.includes(pubgNameClean)) {
                            userTeamName = name;
                            teamData = data;
                            playerMatch = true;
                            break;
                        }
                    }
                    if (playerMatch) break;
                }

                if (!userTeamName) {
                    return statusMsg.edit("❌ **Nuk u gjet asnjë ekip!**\nAdmin, përdor komandën manuale:\n`!addresult <pozicioni> <kills> <Emri i Ekipit>`");
                }

                // 2. Detektimi i Pozicionit të Ekipit
                let detectedRank = null;
                if (cleanText.includes("winner winner") || cleanText.includes("chicken dinner") || cleanText.includes("#1")) {
                    detectedRank = 1;
                }
                const rankMatch = cleanText.match(/(?:rank|place|vendi|#)\s*#?(\d+)/);
                if (rankMatch && !detectedRank) {
                    detectedRank = parseInt(rankMatch[1]);
                }

                // 3. Detektimi i Killa-ve Totale të Ekipit
                let detectedKills = 0;
                const killsMatch = cleanText.match(/(?:kills?|eliminations?|vrasje|defeated)\s*[:\s]*(\d+)/);
                if (killsMatch) {
                    detectedKills = parseInt(killsMatch[1]);
                }

                if (!detectedRank) {
                    return statusMsg.edit(`⚠️ U gjet ekipi **${userTeamName}**, por shtoje manualisht:\n\`!addresult <pozicioni> ${detectedKills} ${userTeamName}\``);
                }

                // 🔥 4. SKANIMI AUTOMATIK I KILLA-VE INDIVIDUALE PËR LOJTARËT
                if (!teamData.player_stats || teamData.player_stats.length === 0) {
                    teamData.player_stats = [
                        { name: teamData.players[0]?.split('@')[0].trim() || 'Lojtari 1', kills: 0 },
                        { name: teamData.players[1]?.split('@')[0].trim() || 'Lojtari 2', kills: 0 },
                        { name: teamData.players[2]?.split('@')[0].trim() || 'Lojtari 3', kills: 0 },
                        { name: teamData.players[4]?.split('@')[0].trim() || 'Lojtari 4', kills: 0 }
                    ];
                }

                let individualKillsReport = [];

                teamData.player_stats.forEach((player) => {
                    const pNameLower = player.name.toLowerCase().trim();
                    const pIndex = cleanText.indexOf(pNameLower);
                    let foundKills = 0;

                    if (pIndex !== -1) {
                        // Marrim segmentin e tekstit që ndodhet fiks pas emrit të lojtarit
                        const textAfterName = cleanText.substring(pIndex + pNameLower.length, pIndex + pNameLower.length + 40);
                        const numMatch = textAfterName.match(/\d+/); // Gjejmë numrin e parë (Kills)
                        
                        if (numMatch) {
                            foundKills = parseInt(numMatch[0]);
                            if (foundKills > 40) foundKills = 0; // Masë sigurie kundrejt erroreve të dëmit (damage)
                        }
                    }

                    player.kills = (player.kills || 0) + foundKills;
                    individualKillsReport.push(`• **${player.name}**: +${foundKills} Kills (Total: ${player.kills})`);
                });

                // 5. Kalkulimi i Pikëve të Ekipit
                const pPts = getPlacementPoints(detectedRank);
                const kPts = detectedKills * 1; 
                const totalMatchPts = pPts + kPts;

                teamData.matches = (teamData.matches || 0) + 1;
                if (detectedRank === 1) teamData.wins = (teamData.wins || 0) + 1;
                teamData.place_pts = (teamData.place_pts || 0) + pPts;
                teamData.kill_pts = (teamData.kill_pts || 0) + kPts;
                teamData.total_pts = (teamData.total_pts || 0) + totalMatchPts;

                TOURNAMENT_DATA.teams.set(userTeamName, teamData);
                saveTournamentData();

                // 6. Dërgimi i Embed-it të Suksesit
                const successEmbed = new EmbedBuilder()
                    .setTitle(`🤖 SKANIM AUTOMATIK I SUKSESSHËM`)
                    .setDescription(`Rezultatet për ekipin: **${userTeamName}**`)
                    .addFields(
                        { name: '🎖️ Pozicioni', value: `#${detectedRank} (+${pPts} PTS)`, inline: true },
                        { name: '💀 Kills Skuadre', value: `${detectedKills} (+${kPts} PTS)`, inline: true },
                        { name: '👤 Kills Individuale të Skanuara', value: individualKillsReport.join('\n'), inline: false },
                        { name: '📈 Total i Shtuar', value: `**+${totalMatchPts} Pikë Ekipi**`, inline: false }
                    )
                    .setColor('#00FF00')
                    .setFooter({ text: 'Nëse diçka u lexua gabim, admini mund ta korrigjojë me !addpk' })
                    .setTimestamp();

                await statusMsg.delete();
                return message.channel.send({ embeds: [successEmbed] });

            } catch (err) {
                console.error(err);
                return statusMsg.edit("❌ Ndodhi një gabim teknik gjatë skanimit të imazhit.");
            }
        }
    }

    // ==========================================
    // KOMANDAT ME TEKST (MANUALE DHE STATISTIKAT)
    // ==========================================
    if (!message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'standings' || command === 'tabela') {
        if (TOURNAMENT_DATA.teams.size === 0) return message.reply("❌ Nuk ka ekipe.");

        const sortedTeams = Array.from(TOURNAMENT_DATA.teams.entries()).sort((a, b) => {
            const totalA = a[1].total_pts || 0;
            const totalB = b[1].total_pts || 0;
            if (totalB !== totalA) return totalB - totalA;
            return (b[1].kill_pts || 0) - (a[1].kill_pts || 0);
        });

        let tableHeader = '`#   Team               M   🍗  P.PTS  K.PTS  TOTAL`\n';
        let tableRows = '';

        sortedTeams.forEach(([name, data], index) => {
            const rankStr = String(index + 1).padEnd(4, ' ');
            const nameStr = (name.length > 18 ? name.substring(0, 15) + '...' : name).padEnd(19, ' ');
            const mStr = String(data.matches || 0).padEnd(4, ' ');
            const wStr = String(data.wins || 0).padEnd(4, ' ');
            const pStr = String(data.place_pts || 0).padEnd(7, ' ');
            const kStr = String(data.kill_pts || 0).padEnd(7, ' ');
            const tStr = String(data.total_pts || 0);
            tableRows += `\`${rankStr}${nameStr}${mStr}${wStr}${pStr}${kStr}${tStr}\`\n`;
        });

        const embed = new EmbedBuilder().setTitle('🏆 DANGER ESPORTS - Overall Standings').setDescription(`${tableHeader}${tableRows}`).setColor('#FF0000');
        return message.channel.send({ embeds: [embed] });
    }

    // KOMANDA: TOP 5 EKIPET SIPAS KILLA-VE
    if (command === 'topkills' || command === 'top') {
        if (TOURNAMENT_DATA.teams.size === 0) return message.reply("❌ Nuk ka asnjë ekip.");
        const sortedTeamsByKills = Array.from(TOURNAMENT_DATA.teams.entries()).sort((a, b) => (b[1].kill_pts || 0) - (a[1].kill_pts || 0)).slice(0, 5);
        let descriptionLines = [];
        sortedTeamsByKills.forEach(([name, data], index) => {
            let medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "💀";
            descriptionLines.push(`${medal} **#${index + 1}** Ekipi: **${name}** — 🎯 **${data.kill_pts || 0} Kills**`);
        });
        const topEmbed = new EmbedBuilder().setTitle('🔥 DANGER ESPORTS — TOP 5 SKUADRAT MË VRASËSE').setDescription(descriptionLines.join('\n\n')).setColor('#FF4500');
        return message.channel.send({ embeds: [topEmbed] });
    }

    // KOMANDA: TOP 5 LOJTARËT MË TË MIRË (MVP KILLS)
    if (command === 'toplojtaret' || command === 'topplayers') {
        let allPlayers = [];
        for (const [teamName, data] of TOURNAMENT_DATA.teams.entries()) {
            if (data.player_stats) {
                data.player_stats.forEach(p => {
                    allPlayers.push({ name: p.name, team: teamName, kills: p.kills || 0 });
                });
            }
        }

        if (allPlayers.length === 0) return message.reply("❌ Nuk ka ende të dhëna lojtarësh të regjistruar.");
        const sortedPlayers = allPlayers.sort((a, b) => b.kills - a.kills).slice(0, 5);

        let descLines = [];
        sortedPlayers.forEach((p, index) => {
            let medal = index === 0 ? "👑" : index === 1 ? "🥈" : index === 2 ? "🥉" : "👤";
            descLines.push(`${medal} **#${index + 1}** Lojtari: **${p.name}** [${p.team}] — 🎯 **${p.kills} Kills**`);
        });

        const playerEmbed = new EmbedBuilder().setTitle('👑 DANGER ESPORTS — TOP 5 LOJTARËT MË VRASËS (MVP)').setDescription(descLines.join('\n\n')).setColor('#00FFCC');
        return message.channel.send({ embeds: [playerEmbed] });
    }

    if (!message.member.permissions.has('Administrator')) return;

    // KOMANDA BACKUP: SHTIMI / EDITIMI MANUAL I KILLA-VE TË LOJTARËVE
    if (command === 'addpk') {
        if (args.length < 5) return message.reply('⚠️ Përdorimi: \`!addpk <k1> <k2> <k3> <k4> <Emri i Ekipit>\`\n*Shembull: !addpk 5 2 0 4 Danger Team*');
        const k1 = parseInt(args[0]);
        const k2 = parseInt(args[1]);
        const k3 = parseInt(args[2]);
        const k4 = parseInt(args[3]);
        const teamName = args.slice(4).join(' ').trim();

        if (isNaN(k1) || isNaN(k2) || isNaN(k3) || isNaN(k4)) return message.reply('❌ Killa-t duhet të jenë numra!');
        if (!TOURNAMENT_DATA.teams.has(teamName)) return message.reply('❌ Skuadra nuk ekziston!');
        
        const team = TOURNAMENT_DATA.teams.get(teamName);
        
        if (!team.player_stats) {
            team.player_stats = [
                { name: team.players[0]?.split('@')[0].trim() || 'Lojtari 1', kills: 0 },
                { name: team.players[1]?.split('@')[0].trim() || 'Lojtari 2', kills: 0 },
                { name: team.players[2]?.split('@')[0].trim() || 'Lojtari 3', kills: 0 },
                { name: team.players[3]?.split('@')[0].trim() || 'Lojtari 4', kills: 0 }
            ];
        }

        team.player_stats[0].kills += k1;
        team.player_stats[1].kills += k2;
        team.player_stats[2].kills += k3;
        team.player_stats[3].kills += k4;

        TOURNAMENT_DATA.teams.set(teamName, team);
        saveTournamentData();
        return message.reply(`✅ U shtuan killa-t manualisht për ekipn **${teamName}**:\n• ${team.player_stats[0].name}: +${k1}\n• ${team.player_stats[1].name}: +${k2}\n• ${team.player_stats[2].name}: +${k3}\n• ${team.player_stats[3].name}: +${k4}`);
    }

    if (command === 'addresult') {
        if (args.length < 3) return message.reply('⚠️ \`!addresult <pozicioni> <kills> <Emri i Ekipit>\`');
        const rank = parseInt(args[0]);
        const kills = parseInt(args[1]);
        const teamName = args.slice(2).join(' ').trim();

        if (!TOURNAMENT_DATA.teams.has(teamName)) return message.reply('❌ Skuadra nuk ekziston.');
        const team = TOURNAMENT_DATA.teams.get(teamName);
        const pPts = getPlacementPoints(rank);

        team.matches = (team.matches || 0) + 1;
        if (rank === 1) team.wins = (team.wins || 0) + 1;
        team.place_pts = (team.place_pts || 0) + pPts;
        team.kill_pts = (team.kill_pts || 0) + kills;
        team.total_pts = (team.total_pts || 0) + (pPts + kills);

        TOURNAMENT_DATA.teams.set(teamName, team);
        saveTournamentData();
        return message.reply(`✅ Rezultati manual u shtua!`);
    }

    if (command === 'resetstats') {
        for (const [name, data] of TOURNAMENT_DATA.teams.entries()) {
            data.matches = 0; data.wins = 0; data.place_pts = 0; data.kill_pts = 0; data.total_pts = 0;
            if (data.player_stats) data.player_stats.forEach(p => p.kills = 0);
            TOURNAMENT_DATA.teams.set(name, data);
        }
        saveTournamentData();
        return message.reply('🔄 Të gjitha statistikat (përfshirë lojtarët) u bënë 0.');
    }

    if (command === 'register' && args[0] === 'open') {
        TOURNAMENT_DATA.reg_open = true;
        const embed = new EmbedBuilder().setTitle('🎮 Regjistrimi është i HAPUR').setDescription(getSlotStatus()).setColor('#00FF00');
        await message.channel.send({ embeds: [embed], components: [getRegistrationRow()] });
    }
});

// ==========================================
// INTERAKSIONET (BUTONAT / MODAL SUBMIT)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && interaction.customId === 'reg_team_btn') {
        if (!TOURNAMENT_DATA.reg_open) return interaction.reply({ content: '❌ Mbyllur.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId('reg_modal').setTitle('🎮 Regjistrimi i Ekipit');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team_name').setLabel('Emri i Ekipit').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p1').setLabel('Lojtari 1 (Pubg Name)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p2').setLabel('Lojtari 2 (Pubg Name)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p3').setLabel('Lojtari 3 (Pubg Name)').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p4').setLabel('Lojtari 4 (Pubg Name)').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'reg_modal') {
        const teamName = interaction.fields.getTextInputValue('team_name').trim();
        const p1 = interaction.fields.getTextInputValue('p1').trim();
        const p2 = interaction.fields.getTextInputValue('p2').trim();
        const p3 = interaction.fields.getTextInputValue('p3').trim();
        const p4 = interaction.fields.getTextInputValue('p4').trim();

        if (TOURNAMENT_DATA.teams.has(teamName)) return interaction.reply({ content: '❌ Emër i zënë.', ephemeral: true });

        const p1Clean = p1.split('@')[0].trim();
        const p2Clean = p2.split('@')[0].trim();
        const p3Clean = p3.split('@')[0].trim();
        const p4Clean = p4.split('@')[0].trim();

        TOURNAMENT_DATA.teams.set(teamName, { 
            leaderId: interaction.user.id, 
            players: [p1, p2, p3, p4],
            player_stats: [
                { name: p1Clean, kills: 0 },
                { name: p2Clean, kills: 0 },
                { name: p3Clean, kills: 0 },
                { name: p4Clean, kills: 0 }
            ],
            matches: 0, wins: 0, place_pts: 0, kill_pts: 0, total_pts: 0 
        });
        saveTournamentData();
        await interaction.reply({ content: `🎉 Ekipi **${teamName}** u regjistrua!`, ephemeral: true });
        return updateSlotsDisplay();
    }
});

client.once('ready', () => { loadTournamentData(); console.log(`✔️ Danger Bot Online!`); });
client.login(process.env.DISCORD_TOKEN);
