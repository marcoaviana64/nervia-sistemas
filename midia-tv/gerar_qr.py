"""Gera o QR code da tela de espera do app da TV (WhatsApp da Nervia com mensagem pronta).
Uso: python3 gerar_qr.py  (precisa de: pip install qrcode pillow). Rodar de novo se mudar o número ou o texto."""
import urllib.parse, qrcode
from pathlib import Path
NUMERO = "5521966869374"   # o mesmo de CONFIG.whatsapp em site/index.html
TEXTO = "Olá! Vi o Mídia Indoor da Nervia numa TV e quero saber como ter no meu negócio."
url = f"https://wa.me/{NUMERO}?text={urllib.parse.quote(TEXTO)}"
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=3)
qr.add_data(url); qr.make(fit=True)
img = qr.make_image(fill_color="#0c1113", back_color="white")
destino = Path(__file__).parent / "app/src/main/res/drawable-nodpi/vitrine_qr.png"
img.save(destino); print(destino, img.size, url)
