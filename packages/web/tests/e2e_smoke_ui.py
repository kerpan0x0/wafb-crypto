"""UI smoke test of the protected flow in headless Chrome (Italian UI)."""
import re, sys
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:4173/"
OUT = "/home/claude/scratch/shots/"
results = []
def ok(name, cond):
    results.append((name, bool(cond))); print(("PASS " if cond else "FAIL ") + name)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 1100, "height": 1000}, locale="it-IT")
    ctx.add_init_script("localStorage.setItem('wafb-lang','it')")
    page = ctx.new_page()
    console_msgs = []
    page.on("console", lambda m: console_msgs.append(m.text))

    # ── Analyst: keys, self-test, invite ──
    page.goto(BASE + "#analyst")
    page.get_by_role("button", name="Genera una nuova coppia di chiavi").click()
    pub = page.locator("code").first.inner_text()
    ok("analyst: public key shown", pub.startswith("age1") and len(pub) == 62)
    page.get_by_role("button", name="Esegui la prova").click()
    expect(page.get_by_text("Prova riuscita")).to_be_visible()
    ok("analyst: self-test passed", True)
    page.fill("#a-case", "C-SMOKE0001")
    page.get_by_role("button", name="Crea invito").click()
    link = page.locator("code", has_text="#invite=").inner_text()
    keyid = page.locator("code").nth(-1).inner_text().replace(" ", "")
    ok("analyst: invite link uses fragment", "#invite=" in link and "?" not in link.split("#")[0])
    ok("analyst: key id 64 hex", re.fullmatch(r"[0-9a-f]{64}", keyid) is not None)
    page.screenshot(path=OUT + "01-analista-invito.png", full_page=True)

    # private key never in storage / URL
    storage = page.evaluate("JSON.stringify(Object.assign({}, localStorage, sessionStorage))")
    ok("analyst: no secret in browser storage", "AGE-SECRET-KEY" not in storage)
    ok("analyst: no secret in URL", "AGE-SECRET" not in page.url)

    # ── Acquirer: open invitation link ──
    page2 = ctx.new_page()
    page2.goto(link)
    expect(page2.get_by_text("C-SMOKE0001")).to_be_visible()
    ok("wizard: invite loaded from link", True)
    ok("wizard: fragment removed from address bar", "#invite" not in page2.url)
    page2.screenshot(path=OUT + "02-wizard-invito.png", full_page=True)
    next_btn = page2.get_by_role("button", name=re.compile("Avanti"))
    preflight_ok = page2.get_by_text("Il browser supporta il percorso protetto").is_visible()
    ok("wizard: preflight passes in Chrome", preflight_ok)
    next_btn.click()

    # verification: wrong fingerprint must block
    page2.screenshot(path=OUT + "03-wizard-verifica.png", full_page=True)
    shown = "".join(page2.locator("[aria-label='Impronta della chiave (64 caratteri)'] span").all_inner_texts())
    ok("wizard: fingerprint shown equals analyst key id", shown == keyid)
    wrong = keyid[:-1] + ("0" if keyid[-1] != "0" else "1")
    page2.fill("#keyid-input", wrong)
    page2.get_by_role("button", name="Confermo il destinatario").click()
    expect(page2.get_by_role("alert")).to_contain_text("NON corrisponde")
    ok("wizard: wrong fingerprint -> blocked", page2.get_by_role("button", name=re.compile("Avanti")).is_disabled())
    page2.screenshot(path=OUT + "04-wizard-impronta-errata.png", full_page=True)
    # prefix only must not enable confirm
    page2.fill("#keyid-input", keyid[:16])
    ok("wizard: prefix-only cannot be confirmed", page2.get_by_role("button", name="Confermo il destinatario").is_disabled())
    # correct fingerprint, typed in groups
    grouped = " ".join(keyid[i:i+4] for i in range(0, 64, 4))
    page2.fill("#keyid-input", grouped.upper())
    page2.get_by_role("button", name="Confermo il destinatario").click()
    expect(page2.get_by_text("Destinatario confermato dall'operatore")).to_be_visible()
    ok("wizard: correct fingerprint -> confirmed", page2.get_by_role("button", name=re.compile("Avanti")).is_enabled())
    page2.screenshot(path=OUT + "05-wizard-confermato.png", full_page=True)
    page2.get_by_role("button", name=re.compile("Avanti")).click()
    expect(page2.get_by_role("button", name="Collega Dispositivo")).to_be_visible()
    ok("wizard: reaches connect step only after confirmation", True)
    page2.screenshot(path=OUT + "06-wizard-collegamento.png", full_page=True)

    # ── Advanced page: legacy needs explicit acknowledgement ──
    page3 = ctx.new_page()
    page3.goto(BASE)
    page3.get_by_role("button", name=re.compile("Avanzata")).click()
    page3.get_by_text("Legacy — NON cifrata").click()
    expect(page3.get_by_text("Ho capito che l'archivio non sarà cifrato")).to_be_visible()
    ok("advanced: legacy warning shown", True)
    # private key pasted as recipient is rejected without echo
    page3.get_by_text("Protetta (cifrata per l'analista)").click()
    secret = page.evaluate("1") and None
    page3.fill("#manual-key", "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ")
    page3.get_by_role("button", name="Usa questa chiave").click()
    alert = page3.get_by_role("alert").inner_text()
    ok("advanced: private key pasted -> explained, not echoed", "PRIVATA" in alert and "QQQQ" not in alert)
    page3.screenshot(path=OUT + "07-avanzata-chiave-privata.png", full_page=True)

    ok("no console errors", not any("Error" in m for m in console_msgs))
    if any("Error" in m for m in console_msgs): print("\n".join(console_msgs[:10]))
    b.close()

failed = [n for n, c in results if not c]
print(f"\n{len(results)-len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
