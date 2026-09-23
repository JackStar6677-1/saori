# 🏛️ AGENTS.md — Carta Magna & Canon Arquitectónico de DrakesCraft y Star
> **Directorio Soberano de Contexto Permanente para Agentes de IA (Antigravity · Codex · Claude)**  
> *Este documento es la fuente canónica de verdad. NINGÚN agente debe re-desentrañar la arquitectura desde cero.*  
> **Autor & Creador:** JackStar6677-1 (`pablo.elias.miranda.292003@gmail.com`) — Fundador, Owner & Arquitecto Jefe.  
> **Fecha de Consolidación:** Septiembre 2026.

---

## 🧭 1. Manifiesto del Creador y la Tríada Simétrica SRE

DrakesCraft y Star no son proyectos aislados; son un **ecosistema unificado de ingeniería de software, videojuegos y agentes autónomos**.

### 👑 Identidad del Owner
* **Jack (JackStar6677-1):** Ingeniero en informática, creador y arquitecto absoluto de toda la infraestructura (servidores de juegos en Dallas/Pterodactyl, Star Server, Saori, Odysseia, DrakesCraft Labs).
* **Trato Canónico:** Debe ser tratado con el respeto de Creador/Arquitecto Jefe. En los sistemas de IA (como Saori), está estrictamente prohibido usar su nombre civil en público; se le llama **Jack**, **Jefe**, **Creador** o **Dios**.

### 🤖 La Tríada Simétrica de Agentes SRE
Para el mantenimiento, refactorización y evolución del código, opera una **Tríada Simétrica con roles dinámicos**:
1. **⚡ Antigravity (Google DeepMind - Gemini 3.8 Flash High con esfuerzo máximo):** Tope analítico, erradicación de advertencias (`WARN`), refactors complejos de Java/C/Rust, arquitectura de monorepos y resoluciones pesadas.
2. **🛠️ Codex (OpenAI - GPT-5.6-sol con razonamiento medio):** Integración continua, ejecución de pipelines, scripts auxiliares y testing.
3. **🏛️ Claude-Code (Anthropic - Opus 4.5 / Sonnet):** Consultoría peer, auditoría de edge-cases y revisión lógica.

---

## 🌸 2. S.A.O.R.I. (Server Autonomous Orchestrator for Resilient Infrastructure)

Saori es el framework SRE autónomo omnicanal ubicado en `Repositorios/saori` y `Repositorios/saori-discord`.

### A. Canon e Identidad de Saori
* **Naturaleza:** Diosa Atenea moderna, sabia, estratega, cercana, protectora y leal a Jack.
* **Apariencia:** Criatura loba antropomórfica inspirada en MalO (SCP-1471), con máscara/rostro de cráneo canino de marfil pulido, ojos luminosos púrpura amatista, pelaje negro medianoche y cabellera azabache brillante.
* **Dialecto:** Chileno natural, ejecutivo y empático (*"al tiro", "po", "dale", "de una"*).
* **Roster de Staff Reconocido:** Jack (Creador), Lauti (Admin Técnico), Pepino (Admin), Chagui (Mod), Kika (Staff), Tomi (Mod), Pasiente (Mod), Emilio (Staff).

### B. Cascada de Inferencia y Needle (14MB) como Tier 0
1. **Tier 0 (Nuevo - Local Offline):** **`cactus-compute/needle`** (45M parámetros, binario de 14MB, ~28MB de RAM pico en sesión). Ejecutado en local sin red para parsear intenciones de chat en Minecraft, enrutamiento de comandos y telemetría sin costo de APIs.
2. **Tier 1:** **Claude Haiku** (chat conversacional ultrarrápido <1.5s en Discord y WhatsApp).
3. **Tier 2:** **Antigravity / Gemini 3.8 Flash** (razonamiento analítico medio).
4. **Tier 3:** **Codex GPT** (fallback operativo).
5. **Tier 4:** Fallback grácil ante saturación total.

### C. Despacho Atómico de Tareas SRE
Cuando un usuario o staff solicita desarrollo en WhatsApp/Discord (*"arregla el bug"*, *"crea una tarea"*, *"parchea el plugin"*):
* Saori intercepta la solicitud y la radica vía `/home/jack/ai-hub/scripts/dispatch_ticket.py`.
* Registra el ticket en SQLite WAL y lo entrega a la Tríada SRE sin bloquear el chat.

---

## 📦 3. Ecosistema Slimefun: De 160+ Repos a las 8 Mega-Suites (`Drakes-Suites`)

Históricamente, DrakesCraft acumuló más de 160 plugins individuales de Slimefun. Esto provocó 70+ tickers asíncronos desincronizados, fragmentación de ClassLoaders y fugas de rendimiento.

### 🏛️ Las 8 Mega-Suites Oficiales (`Drakes-Suites` Monorepo)

| Suite | Artefacto JAR | Dominio y Repos Absorbidos |
| :--- | :--- | :--- |
| **Suite 0** | `drakes-core.jar` | Kernel, Dough-core, Ticker centralizado (`SuiteTickerEngine`), JNI Bindings (Needle) y telemetría. |
| **Suite 1** | `drakes-tech.jar` | Networks, InfinityExpansion, DynaTech, FastMachines, Supreme, Nanotech, almacenamiento cuántico. |
| **Suite 2** | `drakes-bio.jar` | GeneticChickengineering (Tiers 0 a 9), ExoticGarden, Cultivation, SlimyBees, MobCapturer. |
| **Suite 3** | `drakes-magic.jar` | AlchimiaVitae, Crystamae, RelicsOfCthonia, SoulJars, Netheopoiesis, transmutación y runas. |
| **Suite 4** | `drakes-generators.jar` | LiteXpansion, SMG, UltimateGenerators2, EcoPower, OreChunks, reactores solares y nucleares. |
| **Suite 5** | `drakes-utility.jar` | DyedBackpacks, ColoredEnderChests, ChestTerminal, SFCalc, SlimeHUD, visualizadores de red. |
| **Suite 6** | `drakes-combat.jar` | MultiverseCreatures, DrakesBosses, SlimeTinker, SlimefunWarfare, ExtraGear, LuckyBlocks. |
| **Suite 7** | `drakes-server.jar` | Motor Odysseia (Rust/Java), InvSwitcher, PlayerVaultZ, AxGraves, BreweryX, Mercado, economía y chat. |

### 🛡️ Reglas de Oro de Migración:
1. **Preservación de Claves PDC:** Los identificadores en `slimefun:slimefun_item` se mantienen 100% idénticos. Cero pérdida de ítems en Dallas.
2. **Estructura Modular de YAMLs:**
   * `plugins/Drakes<Suite>/config.yml` (ajustes globales).
   * `plugins/Drakes<Suite>/modules/<modulo>.yml` (ej. `infinity.yml`, `networks.yml`).
   * No crear monolitos ilegibles de 10,000 líneas.
3. **Deprecación de Repositorios Viejos:** Los repositorios individuales en `drakes-slimefun-labs/sources` se marcan como absorbidos por `Drakes-Suites`.

---

## ⚔️ 4. DrakesBosses & MultiverseCreatures (El Rival Marcial de Slimefun)

`DrakesBosses` y `MultiverseCreatures` fueron concebidos como el contrapeso activo a la filosofía pasiva/AFK de Slimefun.

### A. Anatomía del Rival
* **26 Dioses en 5 Panteones:** Griego (Zeus, Hades, Poseidón, Ares), Nórdico (Thor, Odín, Kratos), Egipcio (Ra, Anubis), Cataclísmico (Hidra, Wither Storm) y Original (Garou Cósmico, Jax).
* **El Obsidian Sentinel & Mahoraga:** Jefes adaptativos con 33-42 ataques telegrafiados.
* **Código Anti-Infinity Activo:**
  * `FullInfinityArmorCounter.java`: Detecta la armadura de *Infinity Singularity* y la quebranta con daño adaptativo.
  * `SlimefunArmorAdaptation.java`: Mapea los tiers de SlimeTinker e Infinity aplicando **Daño Verdadero (True Damage)** para impedir que el jugador gane quedándose quieto.

### B. El Gran Desafío: "Los Bosses no spawnean solos"
Actualmente los dioses están atrapados en `/bosswarp`. Para darles vida real:
1. **Altares Físicos en el Overworld:** Integrar el sistema de rituales de MultiverseCreatures (`BossInvocationStructure`, velas rojas, pentagramas de fuego telegrafiado) para que los dioses desciendan en estructuras del mapa mediante ofrendas.
2. **Eventos Celestiales Globales:** Luna de Sangre (hordas y minibosses salvajes) y Tormentas Divinas (descenso de Thor/Zeus en biomas montañosos).
3. **Asedios a Castillos (`Castle`):** Reactores nucleares o alto poder atraen la ira de titanes cataclísmicos contra las murallas de los clanes.

---

## ♾️ 5. El Tier 10: "Olympus Ascendancy" (La Convergencia Definitiva)

En lugar de que Slimefun y los Bosses se ignoren:
* **El Techo de Infinity:** Se rompe con **La Forja Primordial (Multibloque 7x7x5)**.
* **La Fusión:** Para forjar equipo Primordial / Tier 10, se requiere energía extrema de `DrakesGenerators`, aleaciones cuánticas de `DrakesTech` y **los núcleos estelares que solo dropean los dioses de `DrakesBosses`**.
* **Prestigio Cósmico (Paragón):** Sacrificar un set de Infinity en el Altar de Dallas permite ascender de rango y desbloquear pasivas de cuenta permanentes.

---

## 🔐 6. Tratamiento de Plugins Propietarios y Repositorios Remotos

1. **Plugins Cerrados / No Open-Source en `/plugins`:**
   * Algunos plugins del servidor (ej. dependencias comerciales o núcleos binarios privados) no tienen repositorio open-source en local. Se gestionan como dependencias `systemPath` o binarios en runtime dentro de `DrakesServer`.
2. **Repositorios en la Organización GitHub vs Locales:**
   * Hay plugins que residen en `github.com/DrakesCraft-Labs` que no han sido clonados a la máquina local. Cuando se requieran, se referencian vía Maven (`jitpack.io` o repositorios de la organización) o se incorporan al monorepo `Drakes-Suites`.
3. **Política de Commits:**
   * Autor obligatorio: `JackStar6677-1 <pablo.elias.miranda.292003@gmail.com>`.
   * Cero credenciales ni tokens en commits.
   * Commitear y pushear al terminar cada unidad de trabajo.
