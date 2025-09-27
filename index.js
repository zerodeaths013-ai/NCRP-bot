// index.js
import 'dotenv/config';
import express from 'express';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js';

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional for instant guild commands
const MOD_LOG_CHANNEL = process.env.MOD_LOG_CHANNEL; // ID of the moderation log channel

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ───── Slash Commands ─────
const commands = [
  // /send command
  new SlashCommandBuilder()
    .setName('send')
    .setDescription('Send a custom embed to a channel')
    .addStringOption(opt => opt.setName('message').setDescription('Message text').setRequired(true))
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send to').setRequired(true))
    .addStringOption(opt => opt.setName('title').setDescription('Embed title').setRequired(false))
    .addStringOption(opt => opt.setName('color').setDescription('Embed color hex, e.g., #5865F2').setRequired(false))
    .addStringOption(opt => opt.setName('footer').setDescription('Embed footer text').setRequired(false))
    .addStringOption(opt => opt.setName('thumbnail').setDescription('Embed thumbnail URL').setRequired(false)),

  // /edit command
  new SlashCommandBuilder()
    .setName('edit')
    .setDescription('Edit your last embed')
    .addStringOption(opt => opt.setName('message').setDescription('New message text').setRequired(true)),

  // /punish command
  new SlashCommandBuilder()
    .setName('punish')
    .setDescription('Punish a user with a record')
    .addUserOption(opt => opt.setName('user').setDescription('User to punish').setRequired(true))
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Type of punishment')
        .setRequired(true)
        .addChoices(
          { name: 'Verbal warning', value: 'Verbal warning' },
          { name: 'Warning', value: 'Warning' },
          { name: 'Strike', value: 'Strike' },
          { name: 'Demote', value: 'Demote' },
          { name: 'Retraining', value: 'Retraining' },
          { name: 'Termination', value: 'Termination' },
          { name: 'Termination + in game ban', value: 'Termination + in game ban' },
          { name: 'Termination + Discord ban', value: 'Termination + Discord ban' }
        )
    )
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for punishment').setRequired(true))
    .addStringOption(opt =>
      opt.setName('appealable')
        .setDescription('Is it appealable?')
        .setRequired(true)
        .addChoices(
          { name: 'Yes', value: 'Yes' },
          { name: 'No', value: 'No' }
        )
    )
    .addStringOption(opt => opt.setName('title').setDescription('Embed title').setRequired(false))
    .addStringOption(opt => opt.setName('color').setDescription('Embed color hex, e.g., #E74C3C').setRequired(false))
    .addStringOption(opt => opt.setName('footer').setDescription('Embed footer text').setRequired(false))
    .addStringOption(opt => opt.setName('thumbnail').setDescription('Embed thumbnail URL').setRequired(false))
].map(c => c.toJSON());

// ───── Register Commands ─────
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log('Guild commands registered.');
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('Global commands registered (may take ~1h).');
    }
  } catch (err) {
    console.error('Error registering commands:', err);
  }
})();

// ───── Store last embed per user ─────
const sentMessages = new Map();

// ───── Client Ready ─────
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ───── Interaction Handler ─────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // ─ /send command ─
  if (interaction.commandName === 'send') {
    const msg = interaction.options.getString('message');
    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title') || 'Announcement';
    const color = interaction.options.getString('color') || '#5865F2';
    const footer = interaction.options.getString('footer') || `Sent by ${interaction.user.tag}`;
    const thumbnail = interaction.options.getString('thumbnail');

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(msg)
      .setColor(color)
      .setFooter({ text: footer })
      .setTimestamp();

    if (thumbnail) embed.setThumbnail(thumbnail);

    try {
      const sent = await channel.send({ embeds: [embed] });
      sentMessages.set(interaction.user.id, { channelId: channel.id, messageId: sent.id });
      await interaction.reply({ content: `✅ Embed sent to ${channel}`, ephemeral: true });
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'Failed to send embed.', ephemeral: true });
    }
  }

  // ─ /edit command ─
  if (interaction.commandName === 'edit') {
    const newText = interaction.options.getString('message');
    const stored = sentMessages.get(interaction.user.id);
    if (!stored) return interaction.reply({ content: 'No message to edit.', ephemeral: true });

    try {
      const channel = await client.channels.fetch(stored.channelId);
      const msgToEdit = await channel.messages.fetch(stored.messageId);
      const editedEmbed = EmbedBuilder.from(msgToEdit.embeds[0] ?? {}).setDescription(newText).setTimestamp();
      await msgToEdit.edit({ embeds: [editedEmbed] });
      interaction.reply({ content: '✅ Embed edited.', ephemeral: true });
    } catch (err) {
      console.error(err);
      interaction.reply({ content: 'Failed to edit embed.', ephemeral: true });
    }
  }

  // ─ /punish command ─
  if (interaction.commandName === 'punish') {
    const target = interaction.options.getUser('user');
    const type = interaction.options.getString('type');
    const reason = interaction.options.getString('reason');
    const appealable = interaction.options.getString('appealable');
    const title = interaction.options.getString('title') || '⚠️ Punishment Record';
    const color = interaction.options.getString('color') || '#E74C3C';
    const footer = interaction.options.getString('footer') || `Punished by ${interaction.user.tag}`;
    const thumbnail = interaction.options.getString('thumbnail');

    const embed = new EmbedBuilder()
      .setTitle(title)
      .addFields(
        { name: 'User', value: `${target.tag}`, inline: true },
        { name: 'Type', value: type, inline: true },
        { name: 'Appealable', value: appealable, inline: true },
        { name: 'Reason', value: reason }
      )
      .setColor(color)
      .setFooter({ text: footer })
      .setTimestamp();

    if (thumbnail) embed.setThumbnail(thumbnail);

    try {
      // send to MOD_LOG_CHANNEL if defined, otherwise current channel
      let channelToSend;
      if (MOD_LOG_CHANNEL) {
        channelToSend = await client.channels.fetch(MOD_LOG_CHANNEL);
      } else {
        channelToSend = interaction.channel;
      }
      await channelToSend.send({ embeds: [embed] });
      interaction.reply({ content: '✅ Punishment recorded.', ephemeral: true });
    } catch (err) {
      console.error(err);
      interaction.reply({ content: 'Failed to send punishment embed.', ephemeral: true });
    }
  }
});

// ───── Express server to keep Railway alive ─────
const app = express();
app.get('/', (_req, res) => res.send('Bot is running.'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Webserver listening on port ${port}`));

client.login(TOKEN);