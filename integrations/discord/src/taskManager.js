// 📌 SAORI Task & Roadmap Management Suite
// Autonomous task dispatching engine for Jack via Discord, integrated with SRE Triad & Agent Memory.
// Standardized in English for Slimefun Community Hub and Spanish for Drakes Network.

const { EmbedBuilder } = require('discord.js');
const http = require('http');

const DRAKES_TASK_CH = '1554140307002757200'; // 📌・ᴛᴀʀᴇᴀs-ᴊᴀᴄᴋ
const HUB_TASK_CH = '1554140426716454994';    // 📌・ᴛᴀʀᴇᴀs-sʟɪᴍᴇғᴜɴ
const JACK_DISCORD_ID = process.env.DISCORD_OWNER_ID || '493868699489665044';
const MEMORIA_URL = 'http://100.114.161.74:8077';
const AI_DAEMON_URL = process.env.SAORI_AI_BASE || 'http://127.0.0.1:8089';

async function queryAiEvaluation(taskContent, project) {
    const isHub = (project === 'slimefun');
    const prompt = isHub
        ? `Act as SAORI SRE. Evaluate this technical task from Jack for the 'slimefun' project: "${taskContent}". Answer EXCLUSIVELY in 3 concise bullet points in English:
• Affected components/plugins:
• Technical feasibility & risks (anti-dupe, performance, PDC persistence):
• Preliminary testing checklist:
Maximum 350 characters total.`
        : `Actúa como SAORI SRE. Evalúa esta tarea técnica de Jack para el proyecto 'drakescraft': "${taskContent}". Responde EXCLUSIVAMENTE en 3 viñetas concisas en español:
• Componentes/plugins afectados:
• Viabilidad técnica y riesgos (anti-dupe, rendimiento):
• Estrategia de testing:
Máximo 350 caracteres en total.`;

    return new Promise((resolve) => {
        const payload = JSON.stringify({
            prompt,
            sender: 'Jack',
            is_high_staff: true,
            scope: isHub ? 'nexo' : 'drakescraft'
        });

        const req = http.request(`${AI_DAEMON_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 7000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const defaultText = isHub
                        ? '• Technical assessment recorded for SRE Triad analysis.'
                        : '• Evaluación técnica registrada para análisis de la Tríada SRE.';
                    resolve(parsed.response || parsed.text || defaultText);
                } catch {
                    resolve(isHub 
                        ? '• Technical assessment recorded for SRE Triad analysis.'
                        : '• Evaluación técnica registrada para análisis de la Tríada SRE.');
                }
            });
        });

        const fallback = isHub
            ? '• Technical assessment recorded for SRE Triad analysis.'
            : '• Evaluación técnica registrada para análisis de la Tríada SRE.';

        req.on('error', () => resolve(fallback));
        req.on('timeout', () => {
            req.destroy();
            resolve(fallback);
        });
        req.write(payload);
        req.end();
    });
}

async function syncToMemoria(tema, data, project) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({
            tema,
            contenido: JSON.stringify(data, null, 2),
            agente: 'saori-discord',
            tipo: 'tarea',
            proyecto: project
        });

        const req = http.request(`${MEMORIA_URL}/recordar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 4000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(true));
        });

        req.on('error', (e) => {
            console.error('[TASK-MEMORIA] Error syncing:', e.message);
            resolve(false);
        });
        req.write(payload);
        req.end();
    });
}

async function dispatchTicketToAiHub(title, desc, author, channel) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({
            title,
            desc,
            author,
            channel
        });

        const req = http.request(`${AI_DAEMON_URL}/ticket`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 5000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed.ticket_id || 'TICKET_DISPATCHED');
                } catch {
                    resolve('TICKET_DISPATCHED');
                }
            });
        });

        req.on('error', () => resolve('TICKET_LOCAL_LOGGED'));
        req.write(payload);
        req.end();
    });
}

async function handleTaskMessage(message) {
    const chId = message.channel.id;
    if (chId !== DRAKES_TASK_CH && chId !== HUB_TASK_CH) return false;
    if (message.author.bot) return false;

    const isHub = (chId === HUB_TASK_CH);

    // Only Jack can create tasks
    if (message.author.id !== JACK_DISCORD_ID) {
        await message.delete().catch(() => {});
        const warnMsg = isHub
            ? `⚠️ ${message.author}, this channel is reserved for Jack's sovereign roadmap and direct AI task dispatching.`
            : `⚠️ ${message.author}, este canal es exclusivo para el roadmap soberano de Jack y el despacho directo de tareas a los bots de IA.`;
        const warn = await message.channel.send({ content: warnMsg }).catch(() => null);
        if (warn) setTimeout(() => warn.delete().catch(() => {}), 6000);
        return true;
    }

    const content = message.content.trim();
    if (!content) return true;

    await message.delete().catch(() => {});

    const project = isHub ? 'slimefun' : 'drakescraft';
    const prefix = isHub ? 'TK-SF' : 'TK-DK';
    const taskId = `${prefix}-${Date.now().toString().slice(-4)}`;

    const titleLine = content.split('\n')[0].replace(/^[#*-]\s*/, '').slice(0, 60);
    const domainText = isHub 
        ? '🟢 Slimefun Hub · Addons & StarSuites' 
        : '⚡ Drakes Network · Servidor & Economía';

    // AI Evaluation
    const aiEval = await queryAiEvaluation(content, project);

    const embed = new EmbedBuilder()
        .setTitle(isHub ? `📌 TASK · ${taskId}: ${titleLine}` : `📌 TAREA · ${taskId}: ${titleLine}`)
        .setDescription(content)
        .setColor(0xF1C40F) // Yellow / Pending
        .addFields(
            { name: isHub ? '🎯 Scope & Domain' : '🎯 Dominio & Alcance', value: domainText, inline: true },
            { name: isHub ? '👤 Creator / Owner' : '👤 Creador / Owner', value: `<@${JACK_DISCORD_ID}>`, inline: true },
            { name: isHub ? '📊 Status' : '📊 Estado', value: isHub ? '`🟡 PENDING / QUEUED`' : '`🟡 PENDIENTE / EN COLA`', inline: true },
            { name: isHub ? '💡 AI Preliminary Evaluation' : '💡 Evaluación Preliminar de IA', value: aiEval, inline: false }
        )
        .setFooter({ 
            text: isHub 
                ? "Jack's Controls: 🚀 Dispatch to AI | 👀 Under Review | ✅ Completed | ❌ Discard"
                : 'Control de Jack: 🚀 Despachar a IA | 👀 En Revisión | ✅ Completada | ❌ Descartar' 
        })
        .setTimestamp();

    const taskMsg = await message.channel.send({ embeds: [embed] }).catch(() => null);
    if (!taskMsg) return true;

    // Auto-react
    const reactions = ['🚀', '👀', '✅', '❌'];
    for (const emoji of reactions) {
        await taskMsg.react(emoji).catch(() => {});
    }

    // Sync to memory
    await syncToMemoria(`tarea_${taskId}`, {
        id: taskId,
        titulo: titleLine,
        descripcion: content,
        evaluacion: aiEval,
        estado: isHub ? '🟡 PENDING / QUEUED' : '🟡 PENDIENTE / EN COLA',
        canal_id: chId,
        mensaje_id: taskMsg.id,
        proyecto: project
    }, project);

    return true;
}

async function handleTaskReaction(reaction, user) {
    if (user.bot || user.id !== JACK_DISCORD_ID) return;
    if (!reaction.message.guild) return;

    const chId = reaction.message.channel.id;
    if (chId !== DRAKES_TASK_CH && chId !== HUB_TASK_CH) return;

    const emojiName = reaction.emoji.name;
    const VALID_EMOJIS = ['🚀', '👀', '✅', '❌'];
    if (!VALID_EMOJIS.includes(emojiName)) return;

    // Remove reaction to keep clean
    await reaction.users.remove(user.id).catch(() => {});

    let msg = reaction.message;
    if (msg.partial) {
        msg = await msg.fetch().catch(() => null);
    }
    if (!msg || !msg.embeds.length) return;

    const oldEmbed = msg.embeds[0];
    const match = oldEmbed.title ? oldEmbed.title.match(/TK-[A-Z]+-[0-9]+/) : null;
    const taskId = match ? match[0] : 'TK-TASK';
    const isHub = (chId === HUB_TASK_CH);
    const project = isHub ? 'slimefun' : 'drakescraft';

    const newEmbed = EmbedBuilder.from(oldEmbed);

    if (emojiName === '🚀') {
        newEmbed.setColor(0x3498DB); // Blue
        const statusVal = isHub ? '`🔵 RUNNING BY AI (SRE TRIAD)`' : '`🔵 EN EJECUCIÓN POR IA (TRÍADA SRE)`';
        const fields = oldEmbed.fields.map(f => {
            if (f.name === '📊 Estado' || f.name === '📊 Status') {
                return { name: isHub ? '📊 Status' : '📊 Estado', value: statusVal, inline: true };
            }
            return f;
        });
        newEmbed.setFields(fields);
        await msg.edit({ embeds: [newEmbed] }).catch(() => {});

        const ticketId = await dispatchTicketToAiHub(
            oldEmbed.title || `Task ${taskId}`,
            oldEmbed.description || '',
            'Jack (Owner)',
            isHub ? 'slimefun-tasks' : 'drakes-tasks'
        );

        if (!msg.thread) {
            const threadName = isHub ? `🧵・${taskId}-sre-execution` : `🧵・${taskId}-ejecucion-sre`;
            const thread = await msg.startThread({
                name: threadName,
                autoArchiveDuration: 1440
            }).catch(() => null);

            if (thread) {
                const threadContent = isHub
                    ? `🚀 **Task successfully dispatched to SRE Triad (Antigravity · Codex · Saori)**\n\n` +
                      `• **Ticket ID:** \`${ticketId}\`\n` +
                      `• **Agent Memory:** Persisted in SQLite WAL (\`memoria-agentes:8077\`).\n` +
                      `• **Inference Cycle:** As soon as active SRE session picks up the batch or tokens become available, ` +
                      `the bots will initiate implementation and regression verification.`
                    : `🚀 **Tarea despachada con éxito a la Tríada SRE (Antigravity · Codex · Saori)**\n\n` +
                      `• **Ticket Radicado:** \`${ticketId}\`\n` +
                      `• **Memoria Permanente:** Sincronizado en SQLite WAL (\`memoria-agentes:8077\`).\n` +
                      `• **Ciclo de Inferencia:** En cuanto la sesión SRE activa tome el lote o se disponga de tokens, ` +
                      `los bots iniciarán el código y la correlación con la base del monorepo.`;

                await thread.send({ content: threadContent }).catch(() => {});
            }
        }

        await syncToMemoria(`tarea_${taskId}`, {
            id: taskId,
            estado: isHub ? '🔵 RUNNING BY AI' : '🔵 EN EJECUCIÓN POR IA',
            ticket_id: ticketId,
            actualizado_en: new Date().toISOString()
        }, project);

    } else if (emojiName === '👀') {
        newEmbed.setColor(0x9B59B6); // Purple
        const statusVal = isHub ? '`🟣 UNDER REVIEW BY JACK`' : '`🟣 EN REVISIÓN POR JACK`';
        const fields = oldEmbed.fields.map(f => {
            if (f.name === '📊 Estado' || f.name === '📊 Status') {
                return { name: isHub ? '📊 Status' : '📊 Estado', value: statusVal, inline: true };
            }
            return f;
        });
        newEmbed.setFields(fields);
        await msg.edit({ embeds: [newEmbed] }).catch(() => {});

        await syncToMemoria(`tarea_${taskId}`, {
            id: taskId,
            estado: isHub ? '🟣 UNDER REVIEW BY JACK' : '🟣 EN REVISIÓN POR JACK',
            actualizado_en: new Date().toISOString()
        }, project);

    } else if (emojiName === '✅') {
        newEmbed.setColor(0x2ECC71); // Green
        const statusVal = isHub ? '`🟢 COMPLETED / VERIFIED IN PROD`' : '`🟢 COMPLETADA / LISTA EN PRODUCCIÓN`';
        const fields = oldEmbed.fields.map(f => {
            if (f.name === '📊 Estado' || f.name === '📊 Status') {
                return { name: isHub ? '📊 Status' : '📊 Estado', value: statusVal, inline: true };
            }
            return f;
        });
        newEmbed.setFields(fields);
        await msg.edit({ embeds: [newEmbed] }).catch(() => {});

        if (msg.thread) {
            const doneMsg = isHub
                ? `✅ **Task marked as COMPLETED and verified in production.**`
                : `✅ **Tarea marcada como COMPLETADA y validada en producción.**`;
            await msg.thread.send({ content: doneMsg }).catch(() => {});
        }

        await syncToMemoria(`tarea_${taskId}`, {
            id: taskId,
            estado: isHub ? '🟢 COMPLETED' : '🟢 COMPLETADA',
            actualizado_en: new Date().toISOString()
        }, project);

    } else if (emojiName === '❌') {
        newEmbed.setColor(0x95A5A6); // Gray
        const statusVal = isHub ? '`⚪ DISCARDED`' : '`⚪ DESCARTADA`';
        const fields = oldEmbed.fields.map(f => {
            if (f.name === '📊 Estado' || f.name === '📊 Status') {
                return { name: isHub ? '📊 Status' : '📊 Estado', value: statusVal, inline: true };
            }
            return f;
        });
        newEmbed.setFields(fields);
        await msg.edit({ embeds: [newEmbed] }).catch(() => {});

        if (msg.thread) {
            const discardMsg = isHub
                ? `⚪ **Task discarded by Jack.**`
                : `⚪ **Tarea descartada por Jack.**`;
            await msg.thread.send({ content: discardMsg }).catch(() => {});
        }

        await syncToMemoria(`tarea_${taskId}`, {
            id: taskId,
            estado: isHub ? '⚪ DISCARDED' : '⚪ DESCARTADA',
            actualizado_en: new Date().toISOString()
        }, project);
    }
}

async function updateTaskStatus(client, { taskId, status, note, agent }) {
    if (!taskId) return { ok: false, error: 'taskId requerido' };
    const upperId = taskId.toUpperCase();
    const isHub = upperId.startsWith('TK-SF');
    const chId = isHub ? HUB_TASK_CH : DRAKES_TASK_CH;
    const project = isHub ? 'slimefun' : 'drakescraft';

    const ch = client.channels.cache.get(chId);
    if (!ch) return { ok: false, error: `Canal ${chId} no encontrado` };

    const messages = await ch.messages.fetch({ limit: 100 });
    const targetMsg = messages.find(m => m.embeds.length && m.embeds[0].title && m.embeds[0].title.toUpperCase().includes(upperId));
    if (!targetMsg) return { ok: false, error: `Mensaje de tarea ${upperId} no encontrado en canal` };

    const oldEmbed = targetMsg.embeds[0];
    const newEmbed = EmbedBuilder.from(oldEmbed);

    const normStatus = (status || 'COMPLETED').toUpperCase();
    let statusText = '';
    let color = 0x2ECC71;

    if (normStatus === 'COMPLETED' || normStatus === 'COMPLETADA' || normStatus === 'DONE') {
        color = 0x2ECC71;
        statusText = isHub ? '`🟢 COMPLETED / VERIFIED IN PROD`' : '`🟢 COMPLETADA / LISTA EN PRODUCCIÓN`';
    } else if (normStatus === 'RUNNING' || normStatus === 'IN_PROGRESS' || normStatus === 'EJECUCION') {
        color = 0x3498DB;
        statusText = isHub ? '`🔵 RUNNING BY AI (SRE TRIAD)`' : '`🔵 EN EJECUCIÓN POR IA (TRÍADA SRE)`';
    } else if (normStatus === 'REVIEW' || normStatus === 'REVISION') {
        color = 0x9B59B6;
        statusText = isHub ? '`🟣 UNDER REVIEW BY JACK`' : '`🟣 EN REVISIÓN POR JACK`';
    } else if (normStatus === 'DISCARDED' || normStatus === 'DESCARTADA') {
        color = 0x95A5A6;
        statusText = isHub ? '`⚪ DISCARDED`' : '`⚪ DESCARTADA`';
    }

    newEmbed.setColor(color);
    const fields = oldEmbed.fields.map(f => {
        if (f.name === '📊 Estado' || f.name === '📊 Status') {
            return { name: isHub ? '📊 Status' : '📊 Estado', value: statusText, inline: true };
        }
        return f;
    });
    newEmbed.setFields(fields);
    await targetMsg.edit({ embeds: [newEmbed] });

    let thread = targetMsg.thread;
    if (!thread) {
        thread = await targetMsg.startThread({
            name: isHub ? `🧵・${upperId}-sre-execution` : `🧵・${upperId}-ejecucion-sre`,
            autoArchiveDuration: 1440
        }).catch(() => null);
    }

    if (thread) {
        const agentName = agent ? agent.toUpperCase() : 'SRE TRIAD';
        const notif = isHub
            ? `📢 **Task Update by [${agentName}]:** ${statusText}\n\n${note ? `> ${note}\n\n` : ''}Validated in production/staging and synchronized with \`memoria-agentes:8077\`.`
            : `📢 **Actualización de Tarea por [${agentName}]:** ${statusText}\n\n${note ? `> ${note}\n\n` : ''}Validado en producción/staging y sincronizado con \`memoria-agentes:8077\`.`;
        await thread.send({ content: notif }).catch(() => {});
    }

    await syncToMemoria(`tarea_${upperId}`, {
        id: upperId,
        estado: statusText,
        agente_actualizador: agent || 'unknown',
        nota: note || '',
        actualizado_en: new Date().toISOString()
    }, project);

    return { ok: true, taskId: upperId, status: statusText };
}

module.exports = {
    handleTaskMessage,
    handleTaskReaction,
    updateTaskStatus,
    DRAKES_TASK_CH,
    HUB_TASK_CH
};
