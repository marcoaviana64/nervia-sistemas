from playwright.sync_api import sync_playwright
import os
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.goto("file://"+os.path.abspath("apresentacao.html")); pg.wait_for_timeout(800)
    pg.pdf(path="Nervia - Aplicativos de notas fiscais.pdf",width="297mm",height="210mm",print_background=True,prefer_css_page_size=True)
    b.close()
