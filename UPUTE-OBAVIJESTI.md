# Postavljanje obavijesti na Telegram

Jednom se postavlja, traje oko 15 minuta i sve se može na mobitelu.
Na kraju ti BTC Radar čuvar svake minute provjerava BTC i šalje poruke na Telegram.

Trebaju ti 4 podatka koja ćeš na kraju upisati u GitHub:

| Ime tajne | Što je | Gdje ga dobiješ |
|---|---|---|
| `TELEGRAM_TOKEN` | ključ tvog Telegram bota | korak 1 |
| `CLOUDFLARE_ACCOUNT_ID` | broj tvog Cloudflare računa | korak 2 |
| `CLOUDFLARE_API_TOKEN` | pristupni ključ za Cloudflare | korak 3 |
| `ALERT_PIN` | PIN koji sam izmisliš | korak 4 |

Spremi ih privremeno u Bilješke dok ih ne upišeš u GitHub, a poslije ih iz Bilješki obriši.

---

## 1. Napravi Telegram bota

1. U Telegramu potraži **@BotFather** (ima plavu kvačicu) i dodirni **Start**.
2. Pošalji mu poruku **/newbot**.
3. Pita za ime: napiši **BTC Radar**.
4. Pita za korisničko ime: mora završavati na `bot`, npr. **msesan_btcradar_bot**. Ako je zauzeto, probaj drugo.
5. BotFather ti pošalje poruku s ključem koji izgleda ovako:
   `7412345678:AAH3k...dugi niz znakova`
   Dodirni ga da se kopira. To je **TELEGRAM_TOKEN**.

Svom botu još ništa ne piši. To dolazi u koraku 7.

## 2. Napravi Cloudflare račun

1. Otvori **https://dash.cloudflare.com/sign-up**, upiši e-mail i lozinku pa potvrdi e-mail.
2. U izborniku otvori **Workers & Pages** (može se zvati i **Compute → Workers**). Ako te pita za ime poddomene (*subdomain*), upiši bilo što, npr. `msesan`, i potvrdi. Ovaj korak je obavezan.
3. Na toj stranici desno (ili ispod na mobitelu) piše **Account ID**: niz od 32 znaka. Kopiraj ga.
   Isti niz vidiš i u adresi stranice: `dash.cloudflare.com/`**`ovaj-niz`**`/...`
   To je **CLOUDFLARE_ACCOUNT_ID**.

## 3. Napravi Cloudflare pristupni ključ

1. Otvori **https://dash.cloudflare.com/profile/api-tokens**
2. Dodirni **Create Token**.
3. Kod predloška **Edit Cloudflare Workers** dodirni **Use template**.
4. Pod **Account Resources** izaberi svoj račun. **Zone Resources** ostavi kako jest.
5. Dodirni **Continue to summary** pa **Create Token**.
6. Kopiraj ključ. **Prikazuje se samo jednom!** To je **CLOUDFLARE_API_TOKEN**.

## 4. Izmisli PIN

Samo brojke, 4 do 8 znamenki (ne 1234). Upisuješ ga u aplikaciju da nitko drugi ne može mijenjati tvoje obavijesti.
To je **ALERT_PIN**.

## 5. Upiši sve u GitHub

1. Otvori **https://github.com/msesan/btc-radar/settings/secrets/actions**
2. Dodirni **New repository secret**.
3. Pod **Name** upiši točno ime, npr. `TELEGRAM_TOKEN`, a pod **Secret** zalijepi vrijednost. Dodirni **Add secret**.
4. Ponovi za sve četiri:
   - `TELEGRAM_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
   - `ALERT_PIN`

Imena moraju biti točno ovakva: velika slova i donja crta.

## 6. Pokreni postavljanje čuvara

1. Otvori **https://github.com/msesan/btc-radar/actions/workflows/deploy-worker.yml**
2. Dodirni **Run workflow** pa ponovno zeleni **Run workflow**.
3. Pričekaj 1–2 minute dok se ne pojavi zelena kvačica ✅.

Ako vidiš i jedno starije pokretanje s crvenim ✗, to je normalno: pokrenulo se prije nego što si upisao tajne.
Ako je novo pokretanje crveno, otvori ga, dodirni korak s crvenim ✗ i pošalji snimku ekrana Claudeu.

## 7. Poveži Telegram

1. U Telegramu otvori svog bota (potraži korisničko ime iz koraka 1) i dodirni **Start**.
2. Bot odgovori: **"BTC Radar je povezan."** ✅

Prvi koji pošalje /start postaje vlasnik bota, pa to napravi odmah.

## 8. Uključi obavijesti u aplikaciji

1. Pričekaj par minuta pa zatvori i ponovno otvori BTC Radar.
2. Skrolaj do **Obavijesti na Telegram**, upiši PIN i dodirni **Spoji**.
3. Izaberi iznos (npr. 400 $ ili 1000 $) i broj minuta pa dodirni **Spremi postavke**.
4. Dodirni **Probna poruka**. Na Telegram mora stići poruka ✅.

Gotovo.

---

## Naredbe u Telegramu

| Naredba | Što radi |
|---|---|
| `/status` | trenutna cijena, ocjena i postavke |
| `/prag 600` | obavijest kad BTC napravi 600 $ |
| `/prozor 5` | u koliko minuta |
| `/signal on` / `/signal off` | uključi ili isključi signal trenda |
| `/pauza` / `/nastavi` | pauziraj ili ponovno uključi sve |
