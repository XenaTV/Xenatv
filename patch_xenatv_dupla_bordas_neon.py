#!/usr/bin/env python3
"""XenaTV 6.9: bordas verde (áudio) / roxo (mudo) na tela dividida.

Aplicar à fonte Java gerada pelo workflow V4, DEPOIS dos patches de áudio,
gestos, favorito e player; ANTES de executar Gradle.

Bordas são apenas foreground Drawable: não interceptam toque, não criam
etiquetas, não mudam player, nem alteram qual canal é selecionado.
"""
from pathlib import Path
import re

JAVA = Path('xena-premium/XenaTV_Android/app/src/main/java/br/com/xenatv/app/FullScreenPlayerActivity.java')
source = JAVA.read_text(encoding='utf-8')

if 'XENA_SPLIT_NEON_AUDIO_V1' in source:
    print('Bordas neon da tela dividida já aplicadas; nada a fazer.')
    raise SystemExit(0)

helper = '''    // XENA_SPLIT_NEON_AUDIO_V1: bordas leves, sem sobreposição de texto no vídeo.
    private android.graphics.drawable.Drawable xenaSplitNeonFrame(boolean withAudio){
        int edge = withAudio ? 0xff43ff91 : 0xffad63ff;
        int halo = withAudio ? 0x6643ff91 : 0x66ad63ff;
        android.graphics.drawable.GradientDrawable glow = new android.graphics.drawable.GradientDrawable();
        glow.setColor(android.graphics.Color.TRANSPARENT);
        glow.setCornerRadius(dp(11));
        glow.setStroke(dp(6), halo);
        android.graphics.drawable.GradientDrawable line = new android.graphics.drawable.GradientDrawable();
        line.setColor(android.graphics.Color.TRANSPARENT);
        line.setCornerRadius(dp(11));
        line.setStroke(dp(2), edge);
        return new android.graphics.drawable.LayerDrawable(
            new android.graphics.drawable.Drawable[]{glow, line});
    }
    private void xenaUpdateSplitNeon(){
        if(firstPane==null || secondPane==null)return;
        if(!splitEnabled){
            firstPane.setForeground(null);
            secondPane.setForeground(null);
            return;
        }
        firstPane.setForeground(xenaSplitNeonFrame(audiblePane==1));
        secondPane.setForeground(xenaSplitNeonFrame(audiblePane==2));
    }
'''

anchor = re.compile(r'(?m)^(\s*)private void setAudible\(int which\)\{')
if len(anchor.findall(source)) != 1:
    raise RuntimeError('Falha segura: método setAudible não encontrado exatamente uma vez.')
source = anchor.sub(lambda m: helper + m.group(0), source, count=1)

# A borda muda no MESMO método que altera o áudio de cada painel.
anchor = 'applyVolume(); // Obedece ao volume configurado e muta sempre a outra tela.'
if source.count(anchor) != 1:
    raise RuntimeError('Falha segura: atualização do áudio não localizada de forma inequívoca.')
source = source.replace(anchor, anchor + '\n        xenaUpdateSplitNeon();', 1)

# Apresenta as cores desde o instante em que o modo Dividir é ativado.
anchor = 'splitHolder.setVisibility(View.VISIBLE);'
if source.count(anchor) != 1:
    raise RuntimeError('Falha segura: início da tela dividida inesperado.')
source = source.replace(anchor, anchor + '\n        xenaUpdateSplitNeon();', 1)

# Ao sair do modo dividido, retira as bordas para não afetar o player único.
anchor = 'selectingSecond=false;splitEnabled=false;stopSecond();secondChannel=null;'
if source.count(anchor) != 1:
    raise RuntimeError('Falha segura: encerramento da tela dividida inesperado.')
source = source.replace(anchor, anchor + '\n        xenaUpdateSplitNeon();', 1)

checks = (
    '0xff43ff91', '0xffad63ff',
    'firstPane.setForeground(xenaSplitNeonFrame(audiblePane==1))',
    'secondPane.setForeground(xenaSplitNeonFrame(audiblePane==2))',
    'applyVolume(); // Obedece ao volume configurado e muta sempre a outra tela.\n        xenaUpdateSplitNeon();',
    'splitHolder.setVisibility(View.VISIBLE);\n        xenaUpdateSplitNeon();',
    'selectingSecond=false;splitEnabled=false;stopSecond();secondChannel=null;\n        xenaUpdateSplitNeon();',
)
for check in checks:
    if check not in source:
        raise AssertionError(f'Patch incompleto: {check}')

JAVA.write_text(source, encoding='utf-8')
print('PATCH OK: painel audível verde neon, painel mudo roxo neon; atualiza por toque e ao ativar/fechar Dividir.')
