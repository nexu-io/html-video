/**
 * Tiny i18n for the studio. No build step, no framework.
 *
 * Usage:
 *   import { t, setLocale, getLocale, AVAILABLE_LOCALES } from './i18n.js';
 *   t('toolbar.export_mp4')
 *   setLocale('es')
 *
 * Locale resolution order:
 *   1. localStorage hv.studio.locale
 *   2. navigator.language prefix ("pt-BR" → "pt", "es-AR" → "es")
 *   3. DEFAULT_LOCALE = "pt"
 *
 * Strings missing in the active locale fall back to en, then the key.
 */

export const DEFAULT_LOCALE = 'pt';
export const AVAILABLE_LOCALES = ['en', 'pt', 'es'];

const DICT = {
  en: {
    'app.empty_pick_create': 'Pick or create a project',
    'app.empty_subtitle':
      'Each project = one HTML video. Choose a template to see the visual baseline, chat with your agent to drive the content, edit per-frame text in the middle column, see the result on the right.',
    'app.no_project': 'no project',

    'sidebar.projects': 'Projects',
    'sidebar.new': '+ New',
    'sidebar.collapse': 'Collapse sidebar',
    'sidebar.empty_list': 'no projects yet',
    'sidebar.menu.rename': '✎ Rename',
    'sidebar.menu.delete': '🗑 Delete',
    'sidebar.rename_prompt': 'New project name',
    'sidebar.delete_confirm': 'Delete "{name}"? This cannot be undone.',

    'toolbar.template': 'Template',
    'toolbar.template_pick': 'Optional · Pick template',
    'toolbar.agent': 'Agent',
    'toolbar.model': 'Model',
    'toolbar.agent_none': '— none —',
    'toolbar.agent_ready': '● ready',
    'toolbar.agent_install': '○ install',
    'toolbar.export_mp4': 'Export MP4',

    'composer.placeholder.no_project': 'Pick a project first…',
    'composer.placeholder.detecting_agents': 'Describe the video while we check for agents…',
    'composer.placeholder.no_agent': 'Install Claude Code (claude CLI) to enable chat…',
    'composer.placeholder.focus':
      'Edit only this frame (click ✕ on the chip above to release)…',
    'composer.placeholder.no_template':
      'Describe a video, or paste an article link / GitHub repo to build one from it.',
    'composer.placeholder.with_template': 'Describe the video — content, names, data… or paste an article link / GitHub repo.',
    'composer.hint': 'Cmd / Ctrl + Enter · drag / paste files · drop a design.md / frame.md to lock brand + motion',
    'composer.send': 'Send',
    'composer.attach': 'Attach file',
    'composer.focus_chip': 'Editing only frame {order} {fid}',
    'composer.focus_clear': 'Clear focus',

    'form.drop_hint': '📎 drag / paste / choose files as assets (logo, screenshot, data CSV… optional)',
    'form.add_file': '+ Add file',
    'form.submit': 'Submit ↵',
    'frame.editing_now': 'Currently editing this frame',

    'chat.empty.title': 'Send a message to start',
    'chat.empty.body':
      'Tell the agent what you want — a single brand card, a multi-frame teaser, a data poster — and it will scaffold the HTML.',
    'chat.summary.form_submitted': '📋 Form submitted',
    'chat.summary.confirm_generate': '✓ Generate',
    'chat.summary.confirm_edit': '✏️ Edit',
    'chat.thinking': 'agent thinking',
    'chat.still_generating': '⏳ This project is still generating in the background — its result will appear here when done (reload preview to refresh).',
    'chat.placeholder.gen_html': '📄 *generating HTML…*',
    'chat.placeholder.plan_graph': '🧭 *planning storyboard…*',
    'chat.empty_reply':
      '⚠️ The agent returned an empty reply. Try rephrasing your request — e.g. tell it the brand / topic / 1-2 concrete details, or which kind of frame you want first.',

    'preview.placeholder.pick_project': 'Pick a project first.',
    'preview.placeholder.pick_template':
      'Send a chat to generate the first HTML.<br>Or pick a template up top for a quick start.',
    'preview.edit_text_on': '✓ Done editing',
    'preview.edit_text_off': '✎ Edit text',
    'preview.edit_text_title': 'Click any text in the preview to edit',
    'preview.edit_text_done_title': 'Finish editing',
    'preview.reload': '↻ Reload preview',
    'preview.no_hv_text':
      'This frame has no editable text (HTML missing data-hv-text).',

    'frames.label': 'Frames',
    'frames.view_graph': 'View graph',
    'frames.enhance': '⚡ Remotion',
    'frames.enhance_hint': 'Render this data frame natively with Remotion (numbers roll, bars grow)',
    'frames.enhanced_revert': '⚡ Remotion ✓ (revert)',
    'frames.enhancing': '⚡ {pct}%…',
    'enhance.done': '⚡ Frame rendered with Remotion',
    'enhance.failed': '⚡ Remotion failed: {message}',

    'text_pane.title': 'Frame text',
    'text_pane.no_project': 'No project.',
    'text_pane.empty_with_frames':
      'No editable text on this frame. Switch to another frame, or click ✎ Edit text on the canvas.',
    'text_pane.empty_no_frames':
      'No editable text yet. Send a chat to generate the first version of the HTML, then per-frame text fields appear here.',
    'text_pane.collapse': 'Collapse panel',
    'text_pane.save_state.idle': '—',
    'text_pane.save_state.typing': 'typing…',
    'text_pane.save_state.saving': 'saving…',
    'text_pane.save_state.saved': 'saved',
    'text_pane.save_state.error': 'error',

    'toast.save_failed': 'Save failed: {message}',
    'toast.saved_changes': 'Saved {n} change(s)',
    'toast.uncaught_error': 'Error: {message}',
    'toast.init_failed': 'Startup failed: {message}',

    'export.starting': '⏵ Starting MP4 export…',
    'export.button_running': '⏵ {pct}% · {stage}',
    'export.done_seconds': '✓ MP4 exported · {seconds}',
    'export.done_no_seconds': '✓ MP4 exported',
    'export.failed': '⚠️ Export failed: {message}',
    'export.stream_interrupted': 'Export stream interrupted: {message}',
    'export.failed_short': 'Export failed: {message}',
    'export.title': '🎬 MP4 ready',
    'export.reveal': 'Reveal in Finder',
    'export.copy_path': 'Copy path',
    'export.copied': 'Path copied',
    'export.copy_failed': 'Copy failed: {message}',
    'export.reveal_failed': 'Open failed: {message}',

    'soundtrack.title': '🎵 Add background music & narration',
    'soundtrack.summary_sub': 'AI music + voiceover, mixed into your export',
    'soundtrack.optional': 'optional',
    'soundtrack.hint': 'Background music + narration, mixed into the MP4 on export.',
    'soundtrack.music_label': 'Background music',
    'soundtrack.music_placeholder': 'Pick a style above, or describe your own — genre, mood, tempo',
    'soundtrack.preset_energetic': 'Energetic',
    'soundtrack.preset_calm': 'Calm',
    'soundtrack.preset_tech': 'Tech',
    'soundtrack.preset_narrative': 'Narrative',
    'soundtrack.preset_minimal': 'Minimal',
    'soundtrack.preset_epic': 'Epic',
    'soundtrack.narration_label': 'Narration / voiceover',
    'soundtrack.step_write': 'Write the script (text)',
    'soundtrack.step_voice': 'Synthesize the voice (audio)',
    'soundtrack.editing_frame': '· editing frame {n}/{total}',
    'soundtrack.draft_frame': '✨ Draft this frame',
    'soundtrack.draft_all': '✨ Draft all frames',
    'soundtrack.gen_music': '🎵 Generate music',
    'soundtrack.gen_narration': '🎙 Synthesize voiceover',
    'soundtrack.empty_music': 'Pick or describe a music style first.',
    'soundtrack.empty_narration': 'Add narration text first (✨ to draft it).',
    'soundtrack.frame_word': 'Frame',
    'soundtrack.total_word': 'Total',
    'soundtrack.drafting': 'Drafting…',
    'soundtrack.draft_need_frames': 'Generate the video first',
    'soundtrack.draft_failed': '⚠️ Draft failed: {message}',
    'soundtrack.narration_placeholder': 'One line per frame — click ✨ to draft from the video (leave empty for none)',
    'soundtrack.voice_label': 'Voice',
    'soundtrack.voice_male_warm': 'Male · Warm',
    'soundtrack.voice_male_pro': 'Male · Professional',
    'soundtrack.voice_male_deep': 'Male · Deep',
    'soundtrack.voice_female_anchor': 'Female · Anchor',
    'soundtrack.voice_female_mature': 'Female · Mature',
    'soundtrack.voice_female_sweet': 'Female · Sweet',
    'soundtrack.fit_durations': '⇄ Fit timing to narration',
    'soundtrack.fit_hint': 'Re-pace each frame by how much narration it has',
    'soundtrack.fitting': 'Fitting…',
    'soundtrack.fitted': '✓ Frame timing fit to narration · {sec}s total',
    'soundtrack.fit_failed': 'Could not fit timing',
    'soundtrack.music_volume': 'Music volume',
    'soundtrack.narration_volume': 'Narration volume',
    'soundtrack.generate': 'Generate soundtrack',
    'soundtrack.generating': 'Generating…',
    'soundtrack.clear': 'Clear',
    'soundtrack.starting': '⏵ Generating soundtrack…',
    'soundtrack.progress_music': '⏵ Generating background music…',
    'soundtrack.progress_narration': '⏵ Generating narration…',
    'soundtrack.done': '✓ Soundtrack ready — it will be mixed in on export',
    'soundtrack.failed': '⚠️ Soundtrack failed: {message}',
    'soundtrack.music_ready': 'Music',
    'soundtrack.narration_ready': 'Narration',
    'soundtrack.empty': 'Enter a music prompt and/or narration text first.',

    'graph.title': 'Content graph',
    'graph.download': '⬇ Download JSON',
    'graph.close': '✕',
    'graph.empty': '(no graph for this project)',
    'graph.error': 'error loading graph: {message}',

    'gallery.title': 'Pick a template',
    'gallery.close': '✕',

    'modal.new.title': 'New project',
    'modal.new.name_label': 'Name',
    'modal.new.name_placeholder': 'e.g. nexu-io launch teaser',
    'modal.new.intent_label': 'Intent (optional)',
    'modal.new.intent_placeholder': 'A one-line description of what this video is about',
    'modal.new.cancel': 'Cancel',
    'modal.new.create': 'Create',
    'modal.new.name_required': 'Name is required',
    'modal.new.created': 'Created "{name}"',
    'modal.new.failed': 'Failed to create project',

    'language.label': 'Language',

    'settings.title': 'Settings',
    'settings.tab.agent': 'Agent',
    'settings.tab.audio': 'Audio',
    'settings.tab.language': 'Language',
    'settings.tab.about': 'About',

    'settings.audio.title': 'Audio · MiniMax',
    'settings.audio.subtitle': 'API key for soundtrack generation (background music + narration).',
    'settings.audio.loading': 'Checking…',
    'settings.audio.api_key': 'API key',
    'settings.audio.api_key_placeholder': 'Paste your MiniMax API key',
    'settings.audio.region': 'API region',
    'settings.audio.region_intl': '🌐 International · api.minimax.io',
    'settings.audio.region_cn': '🇨🇳 China · api.minimaxi.com',
    'settings.audio.base_url': 'Base URL',
    'settings.audio.save': 'Save',
    'settings.audio.clear': 'Clear',
    'settings.audio.configured': '✓ Configured · {key} · from {source}',
    'settings.audio.not_configured': 'No MiniMax key configured yet.',
    'settings.audio.source_config': 'Settings',
    'settings.audio.source_env': 'environment',
    'settings.audio.saving': 'Saving…',
    'settings.audio.saved': '✓ Saved',
    'settings.audio.save_failed': 'Save failed: {message}',
    'settings.audio.need_key': 'Enter an API key first.',
    'settings.audio.hint': 'Stored locally in .html-video/media-config.json. Pick the region that matches your key — an api.minimax.io (International) key will NOT work against api.minimaxi.com (China), and vice-versa. The old api.minimaxi.chat host is retired.',

    'settings.agent.title': 'Agent',
    'settings.agent.subtitle': 'Pick the runtime that turns your chat into HTML.',
    'settings.agent.mode.local': 'Local CLI',
    'settings.agent.mode.byok': 'BYOK (API)',
    'settings.agent.detected': 'Detected agents ({count})',
    'settings.agent.test': 'Test',
    'settings.agent.testing': 'Testing…',
    'settings.agent.test_ok': 'OK · {ms}ms · {bytes}B',
    'settings.agent.test_fail': 'Failed: {message}',
    'settings.agent.empty_reply': 'Failed: agent returned an empty reply',
    'settings.agent.use': 'Use',
    'settings.agent.in_use': 'In use',
    'settings.agent.unavailable': 'Not installed',
    'settings.agent.byok.intro': 'Use your own Anthropic / OpenRouter API key. Reads from environment:',
    'settings.agent.byok.env_key': 'ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN',
    'settings.agent.byok.env_base': 'ANTHROPIC_BASE_URL (optional, defaults to api.anthropic.com)',
    'settings.agent.rescan': '↻ Rescan',
    'settings.agent.rescanned': 'Rescanned',

    'settings.language.title': 'Language',
    'settings.language.subtitle': 'Studio interface language. Re-renders instantly.',
    'settings.language.en': 'English',
    'settings.language.pt': 'Portuguese',
    'settings.language.es': 'Spanish',
    'settings.language.en_sub': 'EN',
    'settings.language.pt_sub': 'PT-BR',
    'settings.language.es_sub': 'ES',

    'settings.about.title': 'About',
    'settings.about.subtitle': 'html-video — open-source HTML→Video meta-layer for coding agents.',
    'settings.about.version': 'Version',
    'settings.about.repo': 'Repo',
    'settings.about.discord': 'Discord',
    'settings.about.license': 'License',

    'toolbar.settings': 'Settings',

    'tpl_preview.cancel': 'Cancel',
    'tpl_preview.use': 'Use this template',
    'tpl_preview.replace_confirm': 'Replace current template with "{name}"? Existing preview content stays put — the agent can rebuild on next chat.',
    'tpl_preview.applied': 'Template: {name}',
    'tpl_preview.fps_dur': '{fps}fps · {duration}s · {aspect}',
    'tpl_preview.source_skill': 'Adapted from',
    'tpl_preview.source_origin': 'Design lineage',
    'tpl_preview.source_license': 'License',
  },

  pt: {
    'app.empty_pick_create': 'Escolha ou crie um projeto',
    'app.empty_subtitle':
      'Cada projeto = um vídeo HTML. Escolha um template para ver a base visual, converse com seu agente para conduzir o conteúdo, edite o texto de cada quadro na coluna do meio e veja o resultado à direita.',
    'app.no_project': 'nenhum projeto',

    'sidebar.projects': 'Projetos',
    'sidebar.new': '+ Novo',
    'sidebar.collapse': 'Recolher barra lateral',
    'sidebar.empty_list': 'nenhum projeto ainda',
    'sidebar.menu.rename': '✎ Renomear',
    'sidebar.menu.delete': '🗑 Excluir',
    'sidebar.rename_prompt': 'Novo nome do projeto',
    'sidebar.delete_confirm': 'Excluir "{name}"? Essa ação não pode ser desfeita.',

    'toolbar.template': 'Template',
    'toolbar.template_pick': 'Opcional · Escolher template',
    'toolbar.agent': 'Agente',
    'toolbar.model': 'Modelo',
    'toolbar.agent_none': '— nenhum —',
    'toolbar.agent_ready': '● pronto',
    'toolbar.agent_install': '○ instalar',
    'toolbar.export_mp4': 'Exportar MP4',

    'composer.placeholder.no_project': 'Escolha um projeto primeiro…',
    'composer.placeholder.detecting_agents': 'Descreva o vídeo enquanto verificamos os agentes…',
    'composer.placeholder.no_agent': 'Instale o Claude Code (CLI claude) para ativar o chat…',
    'composer.placeholder.focus':
      'Editar apenas este quadro (clique no ✕ do chip acima para liberar)…',
    'composer.placeholder.no_template':
      'Descreva um vídeo, ou cole o link de um artigo / repositório do GitHub para criar um a partir dele.',
    'composer.placeholder.with_template': 'Descreva o vídeo — conteúdo, nomes, dados… ou cole o link de um artigo / repositório do GitHub.',
    'composer.hint': 'Cmd / Ctrl + Enter · arraste / cole arquivos · solte um design.md / frame.md para travar marca + movimento',
    'composer.send': 'Enviar',
    'composer.attach': 'Anexar arquivo',
    'composer.focus_chip': 'Editando apenas o quadro {order} {fid}',
    'composer.focus_clear': 'Limpar foco',

    'form.drop_hint': '📎 arraste / cole / escolha arquivos como recursos (logo, captura de tela, CSV de dados… opcional)',
    'form.add_file': '+ Adicionar arquivo',
    'form.submit': 'Enviar ↵',
    'frame.editing_now': 'Editando este quadro no momento',

    'chat.empty.title': 'Envie uma mensagem para começar',
    'chat.empty.body':
      'Diga ao agente o que você quer — um único card de marca, um teaser com vários quadros, um pôster de dados — e ele vai montar o HTML.',
    'chat.summary.form_submitted': '📋 Formulário enviado',
    'chat.summary.confirm_generate': '✓ Gerar',
    'chat.summary.confirm_edit': '✏️ Editar',
    'chat.thinking': 'agente pensando',
    'chat.still_generating': '⏳ Este projeto ainda está sendo gerado em segundo plano — o resultado vai aparecer aqui quando terminar (recarregue a pré-visualização para atualizar).',
    'chat.placeholder.gen_html': '📄 *gerando HTML…*',
    'chat.placeholder.plan_graph': '🧭 *planejando o storyboard…*',
    'chat.empty_reply':
      '⚠️ O agente retornou uma resposta vazia. Tente reformular seu pedido — por exemplo, informe a marca / tema / 1-2 detalhes concretos, ou qual tipo de quadro você quer primeiro.',

    'preview.placeholder.pick_project': 'Escolha um projeto primeiro.',
    'preview.placeholder.pick_template':
      'Envie uma mensagem para gerar o primeiro HTML.<br>Ou escolha um template lá em cima para começar rápido.',
    'preview.edit_text_on': '✓ Edição concluída',
    'preview.edit_text_off': '✎ Editar texto',
    'preview.edit_text_title': 'Clique em qualquer texto na pré-visualização para editar',
    'preview.edit_text_done_title': 'Concluir edição',
    'preview.reload': '↻ Recarregar pré-visualização',
    'preview.no_hv_text':
      'Este quadro não tem texto editável (falta data-hv-text no HTML).',

    'frames.label': 'Quadros',
    'frames.view_graph': 'Ver grafo',
    'frames.enhance': '⚡ Remotion',
    'frames.enhance_hint': 'Renderize este quadro de dados nativamente com o Remotion (números rolam, barras crescem)',
    'frames.enhanced_revert': '⚡ Remotion ✓ (reverter)',
    'frames.enhancing': '⚡ {pct}%…',
    'enhance.done': '⚡ Quadro renderizado com o Remotion',
    'enhance.failed': '⚡ Falha no Remotion: {message}',

    'text_pane.title': 'Texto do quadro',
    'text_pane.no_project': 'Nenhum projeto.',
    'text_pane.empty_with_frames':
      'Nenhum texto editável neste quadro. Mude para outro quadro ou clique em ✎ Editar texto na tela.',
    'text_pane.empty_no_frames':
      'Ainda não há texto editável. Envie uma mensagem para gerar a primeira versão do HTML; os campos de texto de cada quadro aparecem aqui.',
    'text_pane.collapse': 'Recolher painel',
    'text_pane.save_state.idle': '—',
    'text_pane.save_state.typing': 'digitando…',
    'text_pane.save_state.saving': 'salvando…',
    'text_pane.save_state.saved': 'salvo',
    'text_pane.save_state.error': 'erro',

    'toast.save_failed': 'Falha ao salvar: {message}',
    'toast.saved_changes': '{n} alteração(ões) salva(s)',
    'toast.uncaught_error': 'Erro: {message}',
    'toast.init_failed': 'Falha na inicialização: {message}',

    'export.starting': '⏵ Iniciando exportação de MP4…',
    'export.button_running': '⏵ {pct}% · {stage}',
    'export.done_seconds': '✓ MP4 exportado · {seconds}',
    'export.done_no_seconds': '✓ MP4 exportado',
    'export.failed': '⚠️ Falha na exportação: {message}',
    'export.stream_interrupted': 'Fluxo de exportação interrompido: {message}',
    'export.failed_short': 'Falha na exportação: {message}',
    'export.title': '🎬 MP4 pronto',
    'export.reveal': 'Mostrar no Finder',
    'export.copy_path': 'Copiar caminho',
    'export.copied': 'Caminho copiado',
    'export.copy_failed': 'Falha ao copiar: {message}',
    'export.reveal_failed': 'Falha ao abrir: {message}',

    'soundtrack.title': '🎵 Adicionar trilha sonora e narração',
    'soundtrack.summary_sub': 'Música por IA + narração, mixadas na sua exportação',
    'soundtrack.optional': 'opcional',
    'soundtrack.hint': 'Trilha sonora + narração, mixadas no MP4 na exportação.',
    'soundtrack.music_label': 'Trilha sonora',
    'soundtrack.music_placeholder': 'Escolha um estilo acima, ou descreva o seu — gênero, clima, andamento',
    'soundtrack.preset_energetic': 'Energética',
    'soundtrack.preset_calm': 'Calma',
    'soundtrack.preset_tech': 'Tech',
    'soundtrack.preset_narrative': 'Narrativa',
    'soundtrack.preset_minimal': 'Minimalista',
    'soundtrack.preset_epic': 'Épica',
    'soundtrack.narration_label': 'Narração / locução',
    'soundtrack.step_write': 'Escrever o roteiro (texto)',
    'soundtrack.step_voice': 'Sintetizar a voz (áudio)',
    'soundtrack.editing_frame': '· editando quadro {n}/{total}',
    'soundtrack.draft_frame': '✨ Rascunhar este quadro',
    'soundtrack.draft_all': '✨ Rascunhar todos os quadros',
    'soundtrack.gen_music': '🎵 Gerar música',
    'soundtrack.gen_narration': '🎙 Sintetizar locução',
    'soundtrack.empty_music': 'Escolha ou descreva um estilo musical primeiro.',
    'soundtrack.empty_narration': 'Adicione o texto da narração primeiro (✨ para rascunhá-lo).',
    'soundtrack.frame_word': 'Quadro',
    'soundtrack.total_word': 'Total',
    'soundtrack.drafting': 'Rascunhando…',
    'soundtrack.draft_need_frames': 'Gere o vídeo primeiro',
    'soundtrack.draft_failed': '⚠️ Falha ao rascunhar: {message}',
    'soundtrack.narration_placeholder': 'Uma linha por quadro — clique em ✨ para rascunhar a partir do vídeo (deixe em branco para nenhuma)',
    'soundtrack.voice_label': 'Voz',
    'soundtrack.voice_male_warm': 'Masculina · Calorosa',
    'soundtrack.voice_male_pro': 'Masculina · Profissional',
    'soundtrack.voice_male_deep': 'Masculina · Grave',
    'soundtrack.voice_female_anchor': 'Feminina · Apresentadora',
    'soundtrack.voice_female_mature': 'Feminina · Madura',
    'soundtrack.voice_female_sweet': 'Feminina · Suave',
    'soundtrack.fit_durations': '⇄ Ajustar tempo à narração',
    'soundtrack.fit_hint': 'Reajusta o ritmo de cada quadro conforme a quantidade de narração',
    'soundtrack.fitting': 'Ajustando…',
    'soundtrack.fitted': '✓ Tempo dos quadros ajustado à narração · {sec}s no total',
    'soundtrack.fit_failed': 'Não foi possível ajustar o tempo',
    'soundtrack.music_volume': 'Volume da música',
    'soundtrack.narration_volume': 'Volume da narração',
    'soundtrack.generate': 'Gerar trilha sonora',
    'soundtrack.generating': 'Gerando…',
    'soundtrack.clear': 'Limpar',
    'soundtrack.starting': '⏵ Gerando trilha sonora…',
    'soundtrack.progress_music': '⏵ Gerando trilha sonora…',
    'soundtrack.progress_narration': '⏵ Gerando narração…',
    'soundtrack.done': '✓ Trilha sonora pronta — será mixada na exportação',
    'soundtrack.failed': '⚠️ Falha na trilha sonora: {message}',
    'soundtrack.music_ready': 'Música',
    'soundtrack.narration_ready': 'Narração',
    'soundtrack.empty': 'Digite um prompt de música e/ou o texto da narração primeiro.',

    'graph.title': 'Grafo de conteúdo',
    'graph.download': '⬇ Baixar JSON',
    'graph.close': '✕',
    'graph.empty': '(nenhum grafo para este projeto)',
    'graph.error': 'erro ao carregar o grafo: {message}',

    'gallery.title': 'Escolher um template',
    'gallery.close': '✕',

    'modal.new.title': 'Novo projeto',
    'modal.new.name_label': 'Nome',
    'modal.new.name_placeholder': 'ex.: teaser de lançamento nexu-io',
    'modal.new.intent_label': 'Intenção (opcional)',
    'modal.new.intent_placeholder': 'Uma descrição de uma linha sobre o que é este vídeo',
    'modal.new.cancel': 'Cancelar',
    'modal.new.create': 'Criar',
    'modal.new.name_required': 'O nome é obrigatório',
    'modal.new.created': '"{name}" criado',
    'modal.new.failed': 'Falha ao criar o projeto',

    'language.label': 'Idioma',

    'settings.title': 'Configurações',
    'settings.tab.agent': 'Agente',
    'settings.tab.audio': 'Áudio',
    'settings.tab.language': 'Idioma',
    'settings.tab.about': 'Sobre',

    'settings.audio.title': 'Áudio · MiniMax',
    'settings.audio.subtitle': 'Chave de API para geração de trilha sonora (música de fundo + narração).',
    'settings.audio.loading': 'Verificando…',
    'settings.audio.api_key': 'Chave de API',
    'settings.audio.api_key_placeholder': 'Cole sua chave de API do MiniMax',
    'settings.audio.region': 'Região da API',
    'settings.audio.region_intl': '🌐 Internacional · api.minimax.io',
    'settings.audio.region_cn': '🇨🇳 China · api.minimaxi.com',
    'settings.audio.base_url': 'URL base',
    'settings.audio.save': 'Salvar',
    'settings.audio.clear': 'Limpar',
    'settings.audio.configured': '✓ Configurado · {key} · de {source}',
    'settings.audio.not_configured': 'Nenhuma chave do MiniMax configurada ainda.',
    'settings.audio.source_config': 'Configurações',
    'settings.audio.source_env': 'variável de ambiente',
    'settings.audio.saving': 'Salvando…',
    'settings.audio.saved': '✓ Salvo',
    'settings.audio.save_failed': 'Falha ao salvar: {message}',
    'settings.audio.need_key': 'Digite uma chave de API primeiro.',
    'settings.audio.hint': 'Armazenado localmente em .html-video/media-config.json. Escolha a região que corresponde à sua chave — uma chave da api.minimax.io (Internacional) NÃO funciona com a api.minimaxi.com (China), e vice-versa. O antigo host api.minimaxi.chat foi descontinuado.',

    'settings.agent.title': 'Agente',
    'settings.agent.subtitle': 'Escolha o runtime que transforma seu chat em HTML.',
    'settings.agent.mode.local': 'CLI local',
    'settings.agent.mode.byok': 'BYOK (API)',
    'settings.agent.detected': 'Agentes detectados ({count})',
    'settings.agent.test': 'Testar',
    'settings.agent.testing': 'Testando…',
    'settings.agent.test_ok': 'OK · {ms}ms · {bytes}B',
    'settings.agent.test_fail': 'Falha: {message}',
    'settings.agent.empty_reply': 'Falha: o agente retornou uma resposta vazia',
    'settings.agent.use': 'Usar',
    'settings.agent.in_use': 'Em uso',
    'settings.agent.unavailable': 'Não instalado',
    'settings.agent.byok.intro': 'Use sua própria chave de API da Anthropic / OpenRouter. Lida a partir do ambiente:',
    'settings.agent.byok.env_key': 'ANTHROPIC_API_KEY ou ANTHROPIC_AUTH_TOKEN',
    'settings.agent.byok.env_base': 'ANTHROPIC_BASE_URL (opcional, padrão api.anthropic.com)',
    'settings.agent.rescan': '↻ Reescanear',
    'settings.agent.rescanned': 'Reescaneado',

    'settings.language.title': 'Idioma',
    'settings.language.subtitle': 'Idioma da interface do Studio. Aplica na hora.',
    'settings.language.en': 'Inglês',
    'settings.language.pt': 'Português',
    'settings.language.es': 'Espanhol',
    'settings.language.en_sub': 'EN',
    'settings.language.pt_sub': 'PT-BR',
    'settings.language.es_sub': 'ES',

    'settings.about.title': 'Sobre',
    'settings.about.subtitle': 'html-video — meta-camada open-source de HTML→Vídeo para agentes de código.',
    'settings.about.version': 'Versão',
    'settings.about.repo': 'Repositório',
    'settings.about.discord': 'Discord',
    'settings.about.license': 'Licença',

    'toolbar.settings': 'Configurações',

    'tpl_preview.cancel': 'Cancelar',
    'tpl_preview.use': 'Usar este template',
    'tpl_preview.replace_confirm': 'Substituir o template atual por "{name}"? O conteúdo atual da pré-visualização permanece — o agente pode reconstruir na próxima mensagem.',
    'tpl_preview.applied': 'Template: {name}',
    'tpl_preview.fps_dur': '{fps}fps · {duration}s · {aspect}',
    'tpl_preview.source_skill': 'Adaptado de',
    'tpl_preview.source_origin': 'Linhagem de design',
    'tpl_preview.source_license': 'Licença',
  },

  es: {
    'app.empty_pick_create': 'Elige o crea un proyecto',
    'app.empty_subtitle':
      'Cada proyecto es un video HTML. Elige una plantilla para ver la base visual, chatea con tu agente para definir el contenido, edita el texto de cada cuadro en la columna central y mira el resultado a la derecha.',
    'app.no_project': 'sin proyecto',

    'sidebar.projects': 'Proyectos',
    'sidebar.new': '+ Nuevo',
    'sidebar.collapse': 'Contraer barra lateral',
    'sidebar.empty_list': 'aún no hay proyectos',
    'sidebar.menu.rename': '✎ Renombrar',
    'sidebar.menu.delete': '🗑 Eliminar',
    'sidebar.rename_prompt': 'Nuevo nombre del proyecto',
    'sidebar.delete_confirm': '¿Eliminar "{name}"? Esta acción no se puede deshacer.',

    'toolbar.template': 'Plantilla',
    'toolbar.template_pick': 'Opcional · Elegir plantilla',
    'toolbar.agent': 'Agente',
    'toolbar.model': 'Modelo',
    'toolbar.agent_none': '— ninguno —',
    'toolbar.agent_ready': '● listo',
    'toolbar.agent_install': '○ instalar',
    'toolbar.export_mp4': 'Exportar MP4',

    'composer.placeholder.no_project': 'Elige primero un proyecto…',
    'composer.placeholder.detecting_agents': 'Describe el video mientras buscamos agentes…',
    'composer.placeholder.no_agent': 'Instala Claude Code (claude CLI) para habilitar el chat…',
    'composer.placeholder.focus':
      'Edita solo este cuadro (haz clic en ✕ en la etiqueta de arriba para liberarlo)…',
    'composer.placeholder.no_template':
      'Describe un video, o pega el enlace de un artículo o un repositorio de GitHub para crear uno a partir de él.',
    'composer.placeholder.with_template': 'Describe el video: contenido, nombres, datos… o pega el enlace de un artículo o un repositorio de GitHub.',
    'composer.hint': 'Cmd / Ctrl + Enter · arrastra o pega archivos · suelta un design.md / frame.md para fijar marca y movimiento',
    'composer.send': 'Enviar',
    'composer.attach': 'Adjuntar archivo',
    'composer.focus_chip': 'Editando solo el cuadro {order} {fid}',
    'composer.focus_clear': 'Quitar enfoque',

    'form.drop_hint': '📎 arrastra, pega o elige archivos como recursos (logo, captura de pantalla, CSV de datos… opcional)',
    'form.add_file': '+ Agregar archivo',
    'form.submit': 'Enviar ↵',
    'frame.editing_now': 'Editando este cuadro actualmente',

    'chat.empty.title': 'Envía un mensaje para comenzar',
    'chat.empty.body':
      'Dile al agente qué quieres — una tarjeta de marca única, un teaser de varios cuadros, un póster de datos — y él generará el HTML.',
    'chat.summary.form_submitted': '📋 Formulario enviado',
    'chat.summary.confirm_generate': '✓ Generar',
    'chat.summary.confirm_edit': '✏️ Editar',
    'chat.thinking': 'el agente está pensando',
    'chat.still_generating': '⏳ Este proyecto todavía se está generando en segundo plano — el resultado aparecerá aquí cuando termine (recarga la vista previa para actualizar).',
    'chat.placeholder.gen_html': '📄 *generando HTML…*',
    'chat.placeholder.plan_graph': '🧭 *planeando el guion gráfico…*',
    'chat.empty_reply':
      '⚠️ El agente devolvió una respuesta vacía. Intenta reformular tu solicitud — por ejemplo, indica la marca, el tema, uno o dos detalles concretos, o qué tipo de cuadro quieres primero.',

    'preview.placeholder.pick_project': 'Elige primero un proyecto.',
    'preview.placeholder.pick_template':
      'Envía un mensaje para generar el primer HTML.<br>O elige una plantilla arriba para empezar rápido.',
    'preview.edit_text_on': '✓ Edición terminada',
    'preview.edit_text_off': '✎ Editar texto',
    'preview.edit_text_title': 'Haz clic en cualquier texto de la vista previa para editarlo',
    'preview.edit_text_done_title': 'Terminar edición',
    'preview.reload': '↻ Recargar vista previa',
    'preview.no_hv_text':
      'Este cuadro no tiene texto editable (falta data-hv-text en el HTML).',

    'frames.label': 'Cuadros',
    'frames.view_graph': 'Ver gráfico',
    'frames.enhance': '⚡ Remotion',
    'frames.enhance_hint': 'Renderiza este cuadro de datos de forma nativa con Remotion (los números giran, las barras crecen)',
    'frames.enhanced_revert': '⚡ Remotion ✓ (revertir)',
    'frames.enhancing': '⚡ {pct}%…',
    'enhance.done': '⚡ Cuadro renderizado con Remotion',
    'enhance.failed': '⚡ Remotion falló: {message}',

    'text_pane.title': 'Texto del cuadro',
    'text_pane.no_project': 'Sin proyecto.',
    'text_pane.empty_with_frames':
      'Este cuadro no tiene texto editable. Cambia a otro cuadro, o haz clic en ✎ Editar texto en el lienzo.',
    'text_pane.empty_no_frames':
      'Aún no hay texto editable. Envía un mensaje para generar la primera versión del HTML; luego aparecerán aquí los campos de texto de cada cuadro.',
    'text_pane.collapse': 'Contraer panel',
    'text_pane.save_state.idle': '—',
    'text_pane.save_state.typing': 'escribiendo…',
    'text_pane.save_state.saving': 'guardando…',
    'text_pane.save_state.saved': 'guardado',
    'text_pane.save_state.error': 'error',

    'toast.save_failed': 'Error al guardar: {message}',
    'toast.saved_changes': '{n} cambio(s) guardado(s)',
    'toast.uncaught_error': 'Error: {message}',
    'toast.init_failed': 'Error al iniciar: {message}',

    'export.starting': '⏵ Iniciando exportación de MP4…',
    'export.button_running': '⏵ {pct}% · {stage}',
    'export.done_seconds': '✓ MP4 exportado · {seconds}',
    'export.done_no_seconds': '✓ MP4 exportado',
    'export.failed': '⚠️ Error en la exportación: {message}',
    'export.stream_interrupted': 'Transmisión de exportación interrumpida: {message}',
    'export.failed_short': 'Error en la exportación: {message}',
    'export.title': '🎬 MP4 listo',
    'export.reveal': 'Mostrar en Finder',
    'export.copy_path': 'Copiar ruta',
    'export.copied': 'Ruta copiada',
    'export.copy_failed': 'Error al copiar: {message}',
    'export.reveal_failed': 'Error al abrir: {message}',

    'soundtrack.title': '🎵 Agregar música de fondo y narración',
    'soundtrack.summary_sub': 'Música y locución con IA, mezcladas en tu exportación',
    'soundtrack.optional': 'opcional',
    'soundtrack.hint': 'Música de fondo y narración, mezcladas en el MP4 al exportar.',
    'soundtrack.music_label': 'Música de fondo',
    'soundtrack.music_placeholder': 'Elige un estilo arriba, o describe el tuyo — género, ambiente, tempo',
    'soundtrack.preset_energetic': 'Enérgica',
    'soundtrack.preset_calm': 'Tranquila',
    'soundtrack.preset_tech': 'Tecnológica',
    'soundtrack.preset_narrative': 'Narrativa',
    'soundtrack.preset_minimal': 'Minimalista',
    'soundtrack.preset_epic': 'Épica',
    'soundtrack.narration_label': 'Narración / locución',
    'soundtrack.step_write': 'Escribe el guion (texto)',
    'soundtrack.step_voice': 'Sintetiza la voz (audio)',
    'soundtrack.editing_frame': '· editando cuadro {n}/{total}',
    'soundtrack.draft_frame': '✨ Redactar este cuadro',
    'soundtrack.draft_all': '✨ Redactar todos los cuadros',
    'soundtrack.gen_music': '🎵 Generar música',
    'soundtrack.gen_narration': '🎙 Sintetizar locución',
    'soundtrack.empty_music': 'Elige o describe primero un estilo musical.',
    'soundtrack.empty_narration': 'Agrega primero el texto de la narración (✨ para redactarlo).',
    'soundtrack.frame_word': 'Cuadro',
    'soundtrack.total_word': 'Total',
    'soundtrack.drafting': 'Redactando…',
    'soundtrack.draft_need_frames': 'Genera primero el video',
    'soundtrack.draft_failed': '⚠️ Error al redactar: {message}',
    'soundtrack.narration_placeholder': 'Una línea por cuadro — haz clic en ✨ para redactar a partir del video (deja vacío si no quieres ninguna)',
    'soundtrack.voice_label': 'Voz',
    'soundtrack.voice_male_warm': 'Masculina · Cálida',
    'soundtrack.voice_male_pro': 'Masculina · Profesional',
    'soundtrack.voice_male_deep': 'Masculina · Grave',
    'soundtrack.voice_female_anchor': 'Femenina · Presentadora',
    'soundtrack.voice_female_mature': 'Femenina · Madura',
    'soundtrack.voice_female_sweet': 'Femenina · Dulce',
    'soundtrack.fit_durations': '⇄ Ajustar tiempos a la narración',
    'soundtrack.fit_hint': 'Reajusta el ritmo de cada cuadro según cuánta narración tiene',
    'soundtrack.fitting': 'Ajustando…',
    'soundtrack.fitted': '✓ Tiempos de los cuadros ajustados a la narración · {sec}s en total',
    'soundtrack.fit_failed': 'No se pudieron ajustar los tiempos',
    'soundtrack.music_volume': 'Volumen de la música',
    'soundtrack.narration_volume': 'Volumen de la narración',
    'soundtrack.generate': 'Generar banda sonora',
    'soundtrack.generating': 'Generando…',
    'soundtrack.clear': 'Borrar',
    'soundtrack.starting': '⏵ Generando banda sonora…',
    'soundtrack.progress_music': '⏵ Generando música de fondo…',
    'soundtrack.progress_narration': '⏵ Generando narración…',
    'soundtrack.done': '✓ Banda sonora lista — se mezclará al exportar',
    'soundtrack.failed': '⚠️ Error en la banda sonora: {message}',
    'soundtrack.music_ready': 'Música',
    'soundtrack.narration_ready': 'Narración',
    'soundtrack.empty': 'Ingresa primero una descripción de música y/o el texto de la narración.',

    'graph.title': 'Gráfico de contenido',
    'graph.download': '⬇ Descargar JSON',
    'graph.close': '✕',
    'graph.empty': '(sin gráfico para este proyecto)',
    'graph.error': 'error al cargar el gráfico: {message}',

    'gallery.title': 'Elige una plantilla',
    'gallery.close': '✕',

    'modal.new.title': 'Nuevo proyecto',
    'modal.new.name_label': 'Nombre',
    'modal.new.name_placeholder': 'p. ej. teaser de lanzamiento de nexu-io',
    'modal.new.intent_label': 'Intención (opcional)',
    'modal.new.intent_placeholder': 'Una descripción de una línea sobre el tema del video',
    'modal.new.cancel': 'Cancelar',
    'modal.new.create': 'Crear',
    'modal.new.name_required': 'El nombre es obligatorio',
    'modal.new.created': 'Se creó "{name}"',
    'modal.new.failed': 'No se pudo crear el proyecto',

    'language.label': 'Idioma',

    'settings.title': 'Configuración',
    'settings.tab.agent': 'Agente',
    'settings.tab.audio': 'Audio',
    'settings.tab.language': 'Idioma',
    'settings.tab.about': 'Acerca de',

    'settings.audio.title': 'Audio · MiniMax',
    'settings.audio.subtitle': 'Clave de API para generar la banda sonora (música de fondo y narración).',
    'settings.audio.loading': 'Comprobando…',
    'settings.audio.api_key': 'Clave de API',
    'settings.audio.api_key_placeholder': 'Pega tu clave de API de MiniMax',
    'settings.audio.region': 'Región de la API',
    'settings.audio.region_intl': '🌐 Internacional · api.minimax.io',
    'settings.audio.region_cn': '🇨🇳 China · api.minimaxi.com',
    'settings.audio.base_url': 'URL base',
    'settings.audio.save': 'Guardar',
    'settings.audio.clear': 'Borrar',
    'settings.audio.configured': '✓ Configurado · {key} · desde {source}',
    'settings.audio.not_configured': 'Aún no hay una clave de MiniMax configurada.',
    'settings.audio.source_config': 'Configuración',
    'settings.audio.source_env': 'entorno',
    'settings.audio.saving': 'Guardando…',
    'settings.audio.saved': '✓ Guardado',
    'settings.audio.save_failed': 'Error al guardar: {message}',
    'settings.audio.need_key': 'Ingresa primero una clave de API.',
    'settings.audio.hint': 'Se guarda localmente en .html-video/media-config.json. Elige la región que coincida con tu clave — una clave de api.minimax.io (Internacional) NO funcionará con api.minimaxi.com (China), y viceversa. El antiguo host api.minimaxi.chat ya no está en uso.',

    'settings.agent.title': 'Agente',
    'settings.agent.subtitle': 'Elige el entorno de ejecución que convierte tu chat en HTML.',
    'settings.agent.mode.local': 'CLI local',
    'settings.agent.mode.byok': 'BYOK (API)',
    'settings.agent.detected': 'Agentes detectados ({count})',
    'settings.agent.test': 'Probar',
    'settings.agent.testing': 'Probando…',
    'settings.agent.test_ok': 'OK · {ms}ms · {bytes}B',
    'settings.agent.test_fail': 'Error: {message}',
    'settings.agent.empty_reply': 'Error: el agente devolvió una respuesta vacía',
    'settings.agent.use': 'Usar',
    'settings.agent.in_use': 'En uso',
    'settings.agent.unavailable': 'No instalado',
    'settings.agent.byok.intro': 'Usa tu propia clave de API de Anthropic / OpenRouter. Se lee desde el entorno:',
    'settings.agent.byok.env_key': 'ANTHROPIC_API_KEY o ANTHROPIC_AUTH_TOKEN',
    'settings.agent.byok.env_base': 'ANTHROPIC_BASE_URL (opcional, usa api.anthropic.com de forma predeterminada)',
    'settings.agent.rescan': '↻ Volver a escanear',
    'settings.agent.rescanned': 'Escaneo actualizado',

    'settings.language.title': 'Idioma',
    'settings.language.subtitle': 'Idioma de la interfaz de Studio. Se aplica al instante.',
    'settings.language.en': 'Inglés',
    'settings.language.pt': 'Portugués',
    'settings.language.es': 'Español',
    'settings.language.en_sub': 'EN',
    'settings.language.pt_sub': 'PT-BR',
    'settings.language.es_sub': 'ES',

    'settings.about.title': 'Acerca de',
    'settings.about.subtitle': 'html-video — meta-capa de código abierto HTML→Video para agentes de programación.',
    'settings.about.version': 'Versión',
    'settings.about.repo': 'Repositorio',
    'settings.about.discord': 'Discord',
    'settings.about.license': 'Licencia',

    'toolbar.settings': 'Configuración',

    'tpl_preview.cancel': 'Cancelar',
    'tpl_preview.use': 'Usar esta plantilla',
    'tpl_preview.replace_confirm': '¿Reemplazar la plantilla actual por "{name}"? El contenido actual de la vista previa se mantiene — el agente puede reconstruirlo en el próximo chat.',
    'tpl_preview.applied': 'Plantilla: {name}',
    'tpl_preview.fps_dur': '{fps}fps · {duration}s · {aspect}',
    'tpl_preview.source_skill': 'Adaptado de',
    'tpl_preview.source_origin': 'Origen del diseño',
    'tpl_preview.source_license': 'Licencia',
  },
};

const STORAGE_KEY = 'hv.studio.locale';
let _locale = resolveInitialLocale();

function resolveInitialLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && AVAILABLE_LOCALES.includes(stored)) return stored;
  } catch {
    /* localStorage unavailable */
  }
  try {
    const nav = (navigator.language || '').slice(0, 2).toLowerCase();
    if (AVAILABLE_LOCALES.includes(nav)) return nav;
  } catch {
    /* navigator unavailable */
  }
  return DEFAULT_LOCALE;
}

export function getLocale() {
  return _locale;
}

export function setLocale(loc) {
  if (!AVAILABLE_LOCALES.includes(loc)) return;
  _locale = loc;
  try { localStorage.setItem(STORAGE_KEY, loc); } catch {}
  // Notify listeners (the studio app re-renders).
  document.dispatchEvent(new CustomEvent('hv-locale-change', { detail: { locale: loc } }));
}

/**
 * Apply i18n to static DOM elements. Markers:
 *   data-i18n="key"          → textContent
 *   data-i18n-attr="placeholder:key,title:key2"  → set those attrs
 *   data-i18n-html="key"     → innerHTML (caution: only for trusted keys)
 *
 * Call once after DOMContentLoaded and also on every locale change.
 */
export function applyDomI18n(root) {
  const r = root || document;
  r.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  r.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  r.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    const pairs = (el.dataset.i18nAttr || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const pair of pairs) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}

document.addEventListener('hv-locale-change', () => applyDomI18n());
document.addEventListener('DOMContentLoaded', () => applyDomI18n());

/**
 * Translate a key. `params` is a plain object whose keys substitute
 * `{key}` placeholders in the resolved string.
 */
export function t(key, params) {
  const dict = DICT[_locale] ?? DICT[DEFAULT_LOCALE];
  let s = dict[key];
  if (s === undefined) {
    // Fall back to English, then to the key itself.
    s = DICT[DEFAULT_LOCALE][key] ?? key;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
