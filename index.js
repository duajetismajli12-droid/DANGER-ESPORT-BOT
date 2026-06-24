require('dotenv').config();
const fs = require('fs'); 
const http = require('http'); 

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
    console.log(`🚀 [RENDER] Serveri dummy po dëgjon në portën ${PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // 🔥 SHTESË: Lejon bot-in të kërkojë lojtarët dhe t'u japë role
    ]
});

const PREFIX = '!';
const SLOTS_CHANNEL_ID = process.env.SLOTS_CHANNEL_ID; 
const MAP_VOTING_CHANNEL_ID = process.env.MAP_VOTING_CHANNEL_ID; 
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
            
            console.log("✔️ Të dhënat u ngarkuan nga ekipet.json!");
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

// ==========================================
// LOGJIKA NDihMËSE PËR VOTIMIN E HARTAVE
// ==========================================
function getMapButtons(disabled = false) {
    const rows = [];
    let currentRow = new ActionRowBuilder();
    AVAILABLE_MAPS.forEach((map, index) => {
        if (index > 0 && index % 4 === 0) { rows.push(currentRow); currentRow = new ActionRowBuilder(); }
        currentRow.addComponents(new ButtonBuilder().setCustomId(`vote_map_${map.toLowerCase()}`).setLabel(map).setStyle(ButtonStyle.Secondary).setDisabled(disabled));
    });
    rows.push(currentRow);
    return rows;
}

function countMapVotes() {
    const counts = {};
    AVAILABLE_MAPS.forEach(map => counts[map.toLowerCase()] = 0);
    Object.values(TOURNAMENT_DATA.map_votes).forEach(userVotes => {
        userVotes.forEach(map => { if (counts[map] !== undefined) counts[map]++; });
    });
    return counts;
}

// ==========================================
// FUNKSIONET DISPLAY
// ==========================================
async function updateRegistrationDisplay() {
    if (!TOURNAMENT_DATA.reg_msg_id || !TOURNAMENT_DATA.reg_channel_id) return;
    try {
        const channel = await client.channels.fetch(TOURNAMENT_DATA.reg_channel_id);
        const msg = await channel.messages.fetch(TOURNAMENT_DATA.reg_msg_id);
        const embed = new EmbedBuilder().setTitle('🎮 Regjistrimi në Turne është i HAPUR').setColor('#00FF00').setDescription(getSlotStatus());

        if (TOURNAMENT_DATA.reg_open) {
            await msg.edit({ embeds: [embed], components: [getRegistrationRow()] });
        } else {
            const closedEmbed = new EmbedBuilder().setTitle('❌ Regjistrimi në Turne është i MBYLLUR').setColor('#FF0000').setDescription(`Slotet përfundimtare: ${TOURNAMENT_DATA.teams.size}/${TOURNAMENT_DATA.max_slots}`);
            await msg.edit({ embeds: [closedEmbed], components: [] });
        }
    } catch (e) { console.log("Gabim reg_display"); }
}

async function updateSlotsDisplay() {
    if (!SLOTS_CHANNEL_ID) return;
    const embed = new EmbedBuilder().setTitle('🏆 Tabela Zyrtare e Sloteve (LIVE)').setColor('#0099ff').setDescription(generateSlotsList()).setTimestamp().setFooter({ text: "Përditësuar automatikisht" });
    try {
        const targetChannel = await client.channels.fetch(SLOTS_CHANNEL_ID);
        if (TOURNAMENT_DATA.slots_msg_id) {
            try {
                const existingMsg = await targetChannel.messages.fetch(TOURNAMENT_DATA.slots_msg_id);
                await existingMsg.edit({ embeds: [embed] });
                return;
            } catch (err) {}
        }
        const newMsg = await targetChannel.send({ embeds: [embed] });
        TOURNAMENT_DATA.slots_msg_id = newMsg.id;
        saveTournamentData(); 
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

function getSlotStatus() {
    return `Slotet: ${TOURNAMENT_DATA.teams.size}/${TOURNAMENT_DATA.max_slots} të plotësuara\nStatusi: ${TOURNAMENT_DATA.teams.size < TOURNAMENT_DATA.max_slots ? "Duke pranuar Ekipe ✔️" : "Slotet janë Plot ❌"}`;
}

function getRegistrationRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('reg_team_btn').setLabel('Regjistro Ekipin').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('view_teams_btn').setLabel('Shiko Ekipet').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('cancel_reg_btn').setLabel('Anulo Regjistrimin').setStyle(ButtonStyle.Danger)
    );
}

function getCheckInRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('checkin_btn').setLabel('Bëj Check-in Tani').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('view_checked_btn').setLabel('Ekipet e Konfirmuara').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('decline_btn').setLabel('Refuzo Pjesëmarrjen').setStyle(ButtonStyle.Danger)
    );
}

// ==========================================
// KOMANDAT ME TEKST
// ==========================================
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith(PREFIX) || message.author.bot) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'slots') {
        await updateSlotsDisplay();
        return message.reply(`Tabela e sloteve u sinkronizua te kanali: <#${SLOTS_CHANNEL_ID}>`);
    }

    if (!message.member.permissions.has('Administrator')) return;

    if (command === 'postmaps') {
        if (!MAP_VOTING_CHANNEL_ID) return message.reply("❌ Gabim: MAP_VOTING_CHANNEL_ID nuk është caktuar në .env!");
        TOURNAMENT_DATA.maps_voting_open = true;
        saveTournamentData();

        const embed = new EmbedBuilder()
            .setTitle('🎮 MAP VOTING SYSTEM')
            .setDescription('Votoni për hartat tuaja të preferuara! Mund të zgjidhni **deri në 3 harta**.\nKliko përsëri butonin nëse dëshiron të heqësh votën.')
            .setColor('#FF9900')
            .setTimestamp();

        try {
            const votingChannel = await client.channels.fetch(MAP_VOTING_CHANNEL_ID);
            const voteMsg = await votingChannel.send({ embeds: [embed], components: getMapButtons(false) });
            TOURNAMENT_DATA.maps_msg_id = voteMsg.id;
            saveTournamentData();
            return message.reply(`📢 Sesioni i votimit u hap te kanali <#${MAP_VOTING_CHANNEL_ID}>!`);
        } catch (err) { return message.reply("❌ Gabim te votimi."); }
    }

    if (command === 'closemaps') {
        if (!TOURNAMENT_DATA.maps_voting_open || !TOURNAMENT_DATA.maps_msg_id) return message.reply("❌ Nuk ka sesion aktiv.");
        TOURNAMENT_DATA.maps_voting_open = false;
        saveTournamentData();

        try {
            const votingChannel = await client.channels.fetch(MAP_VOTING_CHANNEL_ID);
            const voteMsg = await votingChannel.messages.fetch(TOURNAMENT_DATA.maps_msg_id);
            await voteMsg.edit({ components: getMapButtons(true) });

            const voteCounts = countMapVotes();
            const sortedMaps = Object.entries(voteCounts)
                .map(([name, count]) => ({ name: AVAILABLE_MAPS.find(m => m.toLowerCase() === name), count }))
                .sort((a, b) => b.count - a.count);

            const top3Lines = sortedMaps.slice(0, 3).map((m, idx) => `${idx + 1}. **${m.name}** – ${m.count} vota`).join('\n');
            const resultsEmbed = new EmbedBuilder().setTitle('🛑 VOTIMI U MBYLL').setDescription(`**Top 3 Hartat:**\n\n${top3Lines || "Nuk ka vota."}`).setColor('#FF0000').setTimestamp();

            await votingChannel.send({ embeds: [resultsEmbed] });
            return message.reply("🔒 Votimi u mbyll!");
        } catch (err) { return message.reply("❌ Gabim gjatë mbylljes."); }
    }

    if (command === 'resetmaps') {
        TOURNAMENT_DATA.map_votes = {};
        TOURNAMENT_DATA.maps_voting_open = false;
        TOURNAMENT_DATA.maps_msg_id = null;
        saveTournamentData();
        return message.reply("🔄 Votat e hartave u fshinë.");
    }

    if (command === 'mapsresults') {
        const voteCounts = countMapVotes();
        const resultsLines = Object.entries(voteCounts).map(([name, count]) => `• **${AVAILABLE_MAPS.find(m => m.toLowerCase() === name)}** – ${count} vota`).join('\n');
        const liveEmbed = new EmbedBuilder().setTitle('📊 Rezultatet Live').setDescription(resultsLines).setColor('#00FFFF').setTimestamp();
        return message.reply({ embeds: [liveEmbed] });
    }

    if (command === 'register') {
        const action = args[0]?.toLowerCase();
        if (action === 'open') {
            TOURNAMENT_DATA.reg_open = true;
            const embed = new EmbedBuilder().setTitle('🎮 Regjistrimi në Turne është i HAPUR').setColor('#00FF00').setDescription(getSlotStatus());
            const regMsg = await message.channel.send({ embeds: [embed], components: [getRegistrationRow()] });
            TOURNAMENT_DATA.reg_msg_id = regMsg.id;
            TOURNAMENT_DATA.reg_channel_id = message.channel.id;
            saveTournamentData();
            await updateSlotsDisplay();
        } else if (action === 'close') {
            TOURNAMENT_DATA.reg_open = false;
            await updateRegistrationDisplay(); 
            saveTournamentData();
            await message.channel.send('❌ Regjistrimi është mbyllur.');
        }
    }

    if (command === 'checkin') {
        const action = args[0]?.toLowerCase();
        if (action === 'open') {
            TOURNAMENT_DATA.checkin_open = true;
            saveTournamentData();
            const deadline = args.slice(1).join(' ') || 'TBD';
            const embed = new EmbedBuilder().setTitle('⏱️ CHECK-IN ËSHTË I HAPUR').setColor('#FFCC00').setDescription(`Të gjitha ekipet duhet të konfirmojnë pjesëmarrjen.\n**Afati i fundit:** ${deadline}`);
            await message.channel.send({ embeds: [embed], components: [getCheckInRow()] });
        } else if (action === 'close') {
            TOURNAMENT_DATA.checkin_open = false;
            saveTournamentData();
            await message.channel.send('❌ Faza e Check-in u mbyll.');
        }
    }

    if (command === 'reset_tournament') {
        TOURNAMENT_DATA.teams.clear();
        TOURNAMENT_DATA.checked_in.clear();
        TOURNAMENT_DATA.reg_open = false;
        TOURNAMENT_DATA.checkin_open = false;
        TOURNAMENT_DATA.slots_msg_id = null;
        TOURNAMENT_DATA.reg_msg_id = null;
        TOURNAMENT_DATA.reg_channel_id = null;
        saveTournamentData(); 
        await message.channel.send('🔄 Sistemi u fshi (Reset).');
    }
});

// ==========================================
// INTERAKSIONET (BUTONAT / MODAL SUBMIT)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        const { customId, user } = interaction;

        if (customId.startsWith('vote_map_')) {
            if (!TOURNAMENT_DATA.maps_voting_open) return interaction.reply({ content: "❌ Votimi është i mbyllur.", ephemeral: true });
            const mapNameClean = customId.replace('vote_map_', '');
            const readableMapName = AVAILABLE_MAPS.find(m => m.toLowerCase() === mapNameClean);

            if (!TOURNAMENT_DATA.map_votes[user.id]) TOURNAMENT_DATA.map_votes[user.id] = [];
            let userVotes = TOURNAMENT_DATA.map_votes[user.id];

            if (userVotes.includes(mapNameClean)) {
                TOURNAMENT_DATA.map_votes[user.id] = userVotes.filter(m => m !== mapNameClean);
                saveTournamentData();
                return interaction.reply({ content: `❌ Hoqe votën për **${readableMapName}**. (${TOURNAMENT_DATA.map_votes[user.id].length}/3)`, ephemeral: true });
            }
            if (userVotes.length >= 3) return interaction.reply({ content: "⚠️ Maksimumi 3 harta!", ephemeral: true });

            TOURNAMENT_DATA.map_votes[user.id].push(mapNameClean);
            saveTournamentData();
            return interaction.reply({ content: `✅ Votove për **${readableMapName}**! (${TOURNAMENT_DATA.map_votes[user.id].length}/3)`, ephemeral: true });
        }

        if (customId === 'reg_team_btn') {
            if (!TOURNAMENT_DATA.reg_open) return interaction.reply({ content: '❌ Regjistrimi është mbyllur.', ephemeral: true });
            if (TOURNAMENT_DATA.teams.size >= TOURNAMENT_DATA.max_slots) return interaction.reply({ content: '❌ Slotet janë plot.', ephemeral: true });

            // 🔥 EDITIM: Udhëzojmë liderin që të shkruajë Username-at ose ID e saktë të shokëve
            const modal = new ModalBuilder().setCustomId('reg_modal').setTitle('🎮 Regjistrimi i Ekipit');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team_name').setLabel('Emri i Ekipit').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p1').setLabel('Lojtari 1 (Lideri)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p2').setLabel('Lojtari 2 (Username ose ID)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p3').setLabel('Lojtari 3 (Username ose ID)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p4').setLabel('Lojtari 4 (Username ose ID)').setStyle(TextInputStyle.Short).setRequired(true))
            );
            return interaction.showModal(modal);
        }

        if (customId === 'view_teams_btn') {
            if (TOURNAMENT_DATA.teams.size === 0) return interaction.reply({ content: 'Nuk ka asnjë ekip.', ephemeral: true });
            const teamList = Array.from(TOURNAMENT_DATA.teams.keys()).map(name => `• **${name}**`).join('\n');
            return interaction.reply({ content: `📋 **Ekipet:**\n${teamList}`, ephemeral: true });
        }

        if (customId === 'cancel_reg_btn') {
            let userTeam = null;
            for (const [name, data] of TOURNAMENT_DATA.teams.entries()) { if (data.leaderId === user.id) { userTeam = name; break; } }
            if (userTeam) {
                TOURNAMENT_DATA.teams.delete(userTeam);
                TOURNAMENT_DATA.checked_in.delete(userTeam);
                saveTournamentData(); 
                await interaction.reply({ content: `❌ U anulua ekipi **${userTeam}**`, ephemeral: true });
                await updateRegistrationDisplay();
                return updateSlotsDisplay();
            }
            return interaction.reply({ content: '❌ Nuk jeni lider.', ephemeral: true });
        }

        if (customId === 'checkin_btn') {
            if (!TOURNAMENT_DATA.checkin_open) return interaction.reply({ content: '❌ Check-in jo aktiv.', ephemeral: true });
            let userTeam = null;
            for (const [name, data] of TOURNAMENT_DATA.teams.entries()) { if (data.leaderId === user.id) { userTeam = name; break; } }
            if (!userTeam) return interaction.reply({ content: '❌ Duhet të jeni lider.', ephemeral: true });

            TOURNAMENT_DATA.checked_in.add(userTeam);
            saveTournamentData(); 
            await interaction.reply({ content: `✔ Ekipi **"${userTeam}"** bëri check-in!`, ephemeral: true });
            return updateSlotsDisplay();
        }

        if (customId === 'view_checked_btn') {
            if (TOURNAMENT_DATA.checked_in.size === 0) return interaction.reply({ content: 'Asnjë check-in.', ephemeral: true });
            const checkedList = Array.from(TOURNAMENT_DATA.checked_in).map(team => `•  ✔️ ${team}`).join('\n');
            return interaction.reply({ content: `📋 **Konfirmimet:**\n${checkedList}`, ephemeral: true });
        }

        if (customId === 'decline_btn') {
            let userTeam = null;
            for (const [name, data] of TOURNAMENT_DATA.teams.entries()) { if (data.leaderId === user.id) { userTeam = name; break; } }
            if (userTeam) {
                TOURNAMENT_DATA.teams.delete(userTeam);
                TOURNAMENT_DATA.checked_in.delete(userTeam);
                saveTournamentData(); 
                await interaction.reply({ content: `❌ Ekipi **${userTeam}** u tërhoq.`, ephemeral: true });
                await updateRegistrationDisplay();
                return updateSlotsDisplay();
            }
            return interaction.reply({ content: '❌ S\'jeni në ekip.', ephemeral: true });
        }
    }

    // ==========================================
    // 🔥 LOGJIKA E RE: SUBMIT FORMULARI (ROLET DHE TAG)
    // ==========================================
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'reg_modal') {
            const teamName = interaction.fields.getTextInputValue('team_name').trim();
            const p1Input = interaction.fields.getTextInputValue('p1').trim();
            const p2Input = interaction.fields.getTextInputValue('p2').trim();
            const p3Input = interaction.fields.getTextInputValue('p3').trim();
            const p4Input = interaction.fields.getTextInputValue('p4').trim();
            const players = [p1Input, p2Input, p3Input, p4Input];

            if (TOURNAMENT_DATA.teams.has(teamName)) return interaction.reply({ content: '❌ Emër i zënë.', ephemeral: true });
            const uniquePlayers = new Set(players);
            if (uniquePlayers.size < 4) return interaction.reply({ content: '❌ Lojtarët nuk mund të përsëriten.', ephemeral: true });

            for (const data of TOURNAMENT_DATA.teams.values()) {
                if (players.some(p => data.players.includes(p))) return interaction.reply({ content: '❌ Lojtari është në ekip tjetër.', ephemeral: true });
            }

            // 1. Gjejmë ose krijojmë rolin 'register scrims'
            let scrimsRole = interaction.guild.roles.cache.find(r => r.name === 'register scrims');
            if (!scrimsRole) {
                try {
                    scrimsRole = await interaction.guild.roles.create({
                        name: 'register scrims',
                        color: '#00ffcc',
                        reason: 'Krijuar nga boti për lojtarët e turneut'
                    });
                } catch (err) { console.log("Roli nuk u krijua dot automatikisht."); }
            }

            const resolvedMembers = [];
            const mentionsOutput = [];

            // Lideri (Lojtari 1) është personi që po klikon butonin
            resolvedMembers.push(interaction.member);
            mentionsOutput.push(`<@${interaction.user.id}>`);

            // Funksion inteligjent për gjetjen e lojtarëve të tjerë
            async function getMemberByInput(guild, input) {
                const idMatch = input.match(/\d+/)?.[0]; // Nëse bëjnë copy/paste ID-në ose Tag-un direkt
                if (idMatch) {
                    const m = await guild.members.fetch(idMatch).catch(() => null);
                    if (m) return m;
                }
                const clean = input.toLowerCase();
                let m = guild.members.cache.find(mem => mem.user.username.toLowerCase() === clean || mem.displayName.toLowerCase() === clean);
                if (!m) {
                    const fetched = await guild.members.fetch({ query: clean, limit: 1 }).catch(() => null);
                    if (fetched && fetched.first()) m = fetched.first();
                }
                return m;
            }

            // Kërkojmë Lojtarët 2, 3 dhe 4 në Discord
            for (const pInput of [p2Input, p3Input, p4Input]) {
                const member = await getMemberByInput(interaction.guild, pInput);
                if (member) {
                    resolvedMembers.push(member);
                    mentionsOutput.push(`<@${member.id}>`);
                } else {
                    mentionsOutput.push(`**${pInput}**`); // Nëse s'gjendet në server, mbetet thjesht tekst
                }
            }

            // 2. U japim rolin të gjithë lojtarëve që u gjetën me sukses
            if (scrimsRole) {
                for (const mem of resolvedMembers) {
                    try {
                        await mem.roles.add(scrimsRole);
                    } catch (err) { console.error(`Gabim gjatë dhënies së rolit për një lojtar.`); }
                }
            }

            // Ruajmë skuadrën te JSON
            TOURNAMENT_DATA.teams.set(teamName, { leaderId: interaction.user.id, players: players });
            saveTournamentData(); 

            // 3. DËRGIMI I MESAZHIT ME TAG TE KANALI PUBLIK
            await interaction.channel.send({
                content: `🎉 **Ekipi u regjistrua me sukses!**\n🏆 Ekipi: **${teamName}**\n👥 Lojtarët: ${mentionsOutput.join(', ')}\n✅ Kanë marrë rolin: ${scrimsRole ? `<@&${scrimsRole.id}>` : '**register scrims**'}`
            });

            // Përgjigje private për liderin
            await interaction.reply({ content: '🎉 U regjistruat! Shokët e skuadrës u taguan dhe morën rolin e turneut.', ephemeral: true });
            
            await updateRegistrationDisplay(); 
            return updateSlotsDisplay();
        }
    }
});

client.once('ready', () => {
    loadTournamentData(); 
    console.log(`✔️ Bot-i i Turneut u lidh si ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
