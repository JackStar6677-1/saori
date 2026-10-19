// SAORI Discord · Actualizador de Avatar Oficial Canónico (SCP-1471 Femenino)
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!DISCORD_BOT_TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN no está definido en el entorno.');
    process.exit(1);
}

const possiblePaths = [
    path.resolve(__dirname, '..', 'assets', 'saori_avatar.jpg'),
    path.resolve(__dirname, '..', '..', 'assets', 'saori_avatar.jpg'),
    path.resolve(process.cwd(), 'assets', 'saori_avatar.jpg'),
    path.resolve('/app/src/assets/saori_avatar.jpg'),
    path.resolve('/app/assets/saori_avatar.jpg')
];
const AVATAR_PATH = possiblePaths.find(p => fs.existsSync(p));
if (!AVATAR_PATH) {
    console.error(`❌ Archivo de avatar no encontrado en ninguna de las rutas esperadas:\n${possiblePaths.join('\n')}`);
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.once('ready', async () => {
    try {
        console.log(`🌸 Conectado como ${client.user.tag}. Aplicando nuevo avatar canónico de Saori...`);
        const avatarBuffer = fs.readFileSync(AVATAR_PATH);
        await client.user.setAvatar(avatarBuffer);
        console.log(`✅ ¡Avatar de Saori actualizado con éxito en Discord! (${client.user.tag})`);
    } catch (e) {
        if (e.message && e.message.includes('rate limit')) {
            console.warn('⚠️ Rate limit de Discord al actualizar avatar. Intenta nuevamente en 10 minutos.');
        } else {
            console.error('❌ Error actualizando avatar en Discord:', e.message);
        }
    } finally {
        client.destroy();
        process.exit(0);
    }
});

client.login(DISCORD_BOT_TOKEN).catch(e => {
    console.error('❌ Error iniciando sesión en Discord:', e.message);
    process.exit(1);
});
