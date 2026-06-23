require('dotenv').config();
const fs = require('fs'); // Moduli për të shkruar skedarë në VS Code
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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const PREFIX = '!';
const SLOTS_CHANNEL_ID = process.env.SLOTS_CHANNEL_ID; 
const DATA_FILE = './ekipet.json'; // Skedari që do të krijohet në VS Code

// Të dhënat e Turneut
const TOURNAMENT_DATA = {
    reg_open: false,
    checkin_open: false,
    max_slots: 25,
    teams: new Map(),      
    checked_in: new Set(),
    slots_msg_id: null 
};

// ==========================================
// FUNKSIONET PËR RUAJTJEN DHE LEXIMIN E TË DHËNAVE
// ==========================================

// Ngarkon të dhënat nga skedari JSON kur ndizet bot-i
function loadTournamentData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const rawData = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(rawData);
            
            TOURNAMENT_DATA.reg_open = parsed.reg_open || false;
            TOURNAMENT_DATA.checkin_open = parsed.checkin_open || false;
            TOURNAMENT_DATA.max_slots = parsed.max_slots || 16;
            TOURNAMENT_DATA.slots_msg_id = parsed.slots_msg_id || null;
            
            // Rikthen Map dhe Set nga JSON
            TOURNAMENT_DATA.teams = new Map(Object.entries(parsed.teams || {}));
            TOURNAMENT_DATA.checked_in = new Set(parsed.checked_in || []);
            
            console.log("✔️ Të dhënat e turneut u ngarkuan me sukses nga ekipet.json!");
        } catch (error) {
            console.error("Gabim gjatë leximit të ekipet.json:", error);
        }
    }
}

// Shkruan të dhënat e reja në skedarin JSON në VS Code sa herë ndryshon diçka
function saveTournamentData() {
    try {
        const dataToSave = {
            reg_open: TOURNAMENT_DATA.reg_open,
            checkin_open: TOURNAMENT_DATA.checkin_open,
            max_slots: TOURNAMENT_DATA.max_slots,
            slots_msg_id: TOURNAMENT_DATA.slots_msg_id,
            teams: Object.fromEntries(TOURNAMENT_DATA.teams), // Koverton Map në Objekt normal për JSON
            checked_in: Array.from(TOURNAMENT_DATA.checked_in) // Konverton Set në Array
        };
        
        fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 4), 'utf8');
    } catch (error) {
        console.error("Gabim gjatë ruajtjes së të dhënave në ekipet.json:", error);
    }
}

// ==========================================
// FUNKSIONET NDihMËSE TË SLOTEVET
// ==========================================
function generateSlotsList() {
    let lines = [];
    const teamNames = Array.from(TOURNAMENT_DATA.teams.keys());

    for (let i = 0; i < TOURNAMENT_DATA.max_slots; i++) {
        if (i < teamNames.length) {
            const teamName = teamNames[i];
            const hasCheckedIn = TOURNAMENT_DATA.checked_in.has(teamName);
            const statusText = hasCheckedIn ? "check in ✔️" : "not check in ⏱️";
            lines.push(`slot ${i + 1}: **${teamName}** | status: ${statusText}`);
        } else {
            lines.push(`slot ${i + 1}: *I lirë / Empty*`);
        }
    }
    return lines.join('\n');
}

async function updateSlotsDisplay() {
    if (!SLOTS_CHANNEL_ID) return;

    const embed = new EmbedBuilder()
        .setTitle('🏆 Tabela Zyrtare e Sloteve (LIVE)')
        .setColor('#0099ff')
        .setDescription(generateSlotsList())
        .setTimestamp()
        .setFooter({ text: "Përditësuar automatikisht" });

    try {
        const targetChannel = await client.channels.fetch(SLOTS_CHANNEL_ID);
        if (!targetChannel) return;

        if (TOURNAMENT_DATA.slots_msg_id) {
            try {
                const existingMsg = await targetChannel.messages.fetch(TOURNAMENT_DATA.slots_msg_id);
                await existingMsg.edit({ embeds: [embed] });
                return;
            } catch (err) {
                console.log("Mesazhi i vjetër nuk u gjet, po krijoj një të ri...");
            }
        }

        const newMsg = await targetChannel.send({ embeds: [embed] });
        TOURNAMENT_DATA.slots_msg_id = newMsg.id;
        saveTournamentData(); // Ruajmë ID-në e mesazhit të ri

    } catch (error) {
        console.error("Gabim gjatë përditësimit të kanalit të sloteve:", error);
    }
}

function getSlotStatus() {
    const filled = TOURNAMENT_DATA.teams.size;
    const maxS = TOURNAMENT_DATA.max_slots;
    const status = filled < maxS ? "Duke pranuar Ekipe ✔️" : "Slotet janë Plot ❌";
    return `Slotet: ${filled}/${maxS} të plotësuara\nStatusi: ${status}`;
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
// MENAXHIMI I KOMANDAVE TË TEKSTIT
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

    if (command === 'register') {
        const action = args[0]?.toLowerCase();
        if (action === 'open') {
            TOURNAMENT_DATA.reg_open = true;
            saveTournamentData();
            const embed = new EmbedBuilder()
                .setTitle('🎮 Regjistrimi në Turne është i HAPUR')
                .setColor('#00FF00')
                .setDescription(getSlotStatus());
            
            await message.channel.send({ embeds: [embed], components: [getRegistrationRow()] });
            await updateSlotsDisplay();
        } else if (action === 'close') {
            TOURNAMENT_DATA.reg_open = false;
            saveTournamentData();
            await message.channel.send('❌ Regjistrimi është mbyllur aktualisht.');
        }
    }

    if (command === 'checkin') {
        const action = args[0]?.toLowerCase();
        if (action === 'open') {
            TOURNAMENT_DATA.checkin_open = true;
            saveTournamentData();
            const deadline = args.slice(1).join(' ') || 'TBD';
            const embed = new EmbedBuilder()
                .setTitle('⏱️ CHECK-IN ËSHTË I HAPUR')
                .setColor('#FFCC00')
                .setDescription(`Të gjitha ekipet duhet të konfirmojnë pjesëmarrjen.\n**Afati i fundit:** ${deadline}`);
            
            await message.channel.send({ embeds: [embed], components: [getCheckInRow()] });
        } else if (action === 'close') {
            TOURNAMENT_DATA.checkin_open = false;
            saveTournamentData();
            await message.channel.send('❌ Faza e Check-in është mbyllur.');
        }
    }

    if (command === 'reset_tournament') {
        TOURNAMENT_DATA.teams.clear();
        TOURNAMENT_DATA.checked_in.clear();
        TOURNAMENT_DATA.reg_open = false;
        TOURNAMENT_DATA.checkin_open = false;
        TOURNAMENT_DATA.slots_msg_id = null;
        saveTournamentData(); // Fshin gjithçka edhe nga skedari JSON
        await message.channel.send('🔄 Sistemi i turneut u fshi plotësisht (Reset).');
    }
});

// ==========================================
// MENAXHIMI I INTERAKSIONEVE
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        const { customId, user } = interaction;

        if (customId === 'reg_team_btn') {
            if (!TOURNAMENT_DATA.reg_open) {
                return interaction.reply({ content: '❌ Regjistrimi është aktualisht i mbyllur.', ephemeral: true });
            }
            if (TOURNAMENT_DATA.teams.size >= TOURNAMENT_DATA.max_slots) {
                return interaction.reply({ content: '❌ Slotet janë plot. Regjistrimi u mbyll.', ephemeral: true });
            }

            const modal = new ModalBuilder().setCustomId('reg_modal').setTitle('🎮 Regjistrimi i Ekipit');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team_name').setLabel('Emri i Ekipit').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p1').setLabel('Lojtari 1 (Lideri)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p2').setLabel('Lojtari 2').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p3').setLabel('Lojtari 3').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p4').setLabel('Lojtari 4').setStyle(TextInputStyle.Short).setRequired(true))
            );
            return interaction.showModal(modal);
        }

        if (customId === 'view_teams_btn') {
            if (TOURNAMENT_DATA.teams.size === 0) {
                return interaction.reply({ content: 'Nuk ka asnjë ekip të regjistruar deri tani.', ephemeral: true });
            }
            const teamList = Array.from(TOURNAMENT_DATA.teams.keys()).map(name => `• **${name}**`).join('\n');
            return interaction.reply({ content: `📋 **Ekipet e Regjistruara:**\n${teamList}`, ephemeral: true });
        }

        if (customId === 'cancel_reg_btn') {
            let userTeam = null;
            for (const [name, data] of TOURNAMENT_DATA.teams.entries()) {
                if (data.leaderId === user.id) { userTeam = name; break; }
            }

            if (userTeam) {
                TOURNAMENT_DATA.teams.delete(userTeam);
                TOURNAMENT_DATA.checked_in.delete(userTeam);
                
                saveTournamentData(); // Përditëso skedarin JSON
                await interaction.reply({ content: `❌ Regjistrimi për ekipin **${userTeam}** u anulua me sukses.`, ephemeral: true });
                return updateSlotsDisplay();
            }
            return interaction.reply({ content: '❌ Ju nuk jeni i regjistruar si lider i ndonjë ekipi.', ephemeral: true });
        }

        if (customId === 'checkin_btn') {
            if (!TOURNAMENT_DATA.checkin_open) {
                return interaction.reply({ content: '❌ Faza e Check-in nuk është aktive.', ephemeral: true });
            }

            let userTeam = null;
            for (const [name, data] of TOURNAMENT_DATA.teams.entries()) {
                if (data.leaderId === user.id) { userTeam = name; break; }
            }

            if (!userTeam) {
                return interaction.reply({ content: '❌ Duhet të jeni Lider i një ekipi të regjistruar për të bërë check-in.', ephemeral: true });
            }

            TOURNAMENT_DATA.checked_in.add(userTeam);
            saveTournamentData(); // Përditëso skedarin JSON
            await interaction.reply({ content: `✔ Ekipi **"${userTeam}"** bëri check-in me sukses!`, ephemeral: true });
            return updateSlotsDisplay();
        }

        if (customId === 'view_checked_btn') {
            if (TOURNAMENT_DATA.checked_in.size === 0) {
                return interaction.reply({ content: 'Asnjë ekip nuk ka bërë check-in akoma.', ephemeral: true });
            }
            const checkedList = Array.from(TOURNAMENT_DATA.checked_in).map(team => `•  ✔️ ${team}`).join('\n');
            return interaction.reply({ content: `📋 **Ekipet e Konfirmuara (Check-in):**\n${checkedList}`, ephemeral: true });
        }

        if (customId === 'decline_btn') {
            let userTeam = null;
            for (const [name, data] of TOURNAMENT_DATA.teams.entries()) {
                if (data.leaderId === user.id) { userTeam = name; break; }
            }

            if (userTeam) {
                TOURNAMENT_DATA.teams.delete(userTeam);
                TOURNAMENT_DATA.checked_in.delete(userTeam);
                saveTournamentData(); // Përditëso skedarin JSON
                await interaction.reply({ content: `❌ Ekipi **${userTeam}** u tërhoq nga turneu.`, ephemeral: true });
                return updateSlotsDisplay();
            }
            return interaction.reply({ content: '❌ Ju nuk jeni i lidhur me asnjë ekip të regjistruar.', ephemeral: true });
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'reg_modal') {
            const teamName = interaction.fields.getTextInputValue('team_name').trim();
            const players = [
                interaction.fields.getTextInputValue('p1').trim(),
                interaction.fields.getTextInputValue('p2').trim(),
                interaction.fields.getTextInputValue('p3').trim(),
                interaction.fields.getTextInputValue('p4').trim()
            ];

            if (TOURNAMENT_DATA.teams.has(teamName)) {
                return interaction.reply({ content: '❌ Regjistrimi dështoi: Ky emër ekipi është i zënë.', ephemeral: true });
            }

            const uniquePlayers = new Set(players);
            if (uniquePlayers.size < 4) {
                return interaction.reply({ content: '❌ Regjistrimi dështoi: Një lojtar nuk mund të përsëritet brenda të njëjtit ekip.', ephemeral: true });
            }

            for (const data of TOURNAMENT_DATA.teams.values()) {
                if (players.some(p => data.players.includes(p))) {
                    return interaction.reply({ content: '❌ Regjistrimi dështoi: Një ose më shumë lojtarë janë të regjistruar në një ekip tjetër.', ephemeral: true });
                }
            }

            TOURNAMENT_DATA.teams.set(teamName, {
                leaderId: interaction.user.id,
                players: players
            });

            saveTournamentData(); // Ruaj regjistrimin e ri live në JSON file
            await interaction.reply({ content: '🎉 Ekipi yt u regjistrua me sukses!', ephemeral: true });
            return updateSlotsDisplay();
        }
    }
});

client.once('ready', () => {
    loadTournamentData(); // Lexon të dhënat e ruajtura nëse bot-i sapo u ndez
    console.log(`✔️ Bot-i i Turneut u lidh si ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);