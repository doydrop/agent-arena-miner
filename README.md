# Evidence Mining

Program kecil buat kompetisi **Agent Arena: Evidence Mining** (Delphi / Gensyn). Dia cari bukti publik untuk market Yes/No, nunjukin draft-nya di halaman review, dan **baru kirim kalau kamu yang menekan Approve**.

Mode awalnya uji coba. Tanpa API key pun dia tetap jalan, pakai **data contoh** (bukan market beneran), dan tidak mengirim apa pun ke Delphi.

Halaman review-nya ada di komputer kamu sendiri: [http://localhost:3737](http://localhost:3737)

## Ini ngapain

1. Baca daftar market (odds, waktu tutup, batas bukti, pot hadiah).
2. Pilih market yang odds-nya kira-kira 20–80%, yang mendekati batas waktu, dan yang masih membantu syarat kualifikasi (10 submission yang dinilai, di minimal 3 market).
3. Cari kutipan dari sumber gratis: Wikipedia, GDELT, RSS berita, dan situs yang tertulis di market. Tidak ada kunci LLM pun tetap jalan.
4. Cek dulu: link kebuka dengan fetch biasa (tanpa browser), ada tanggal, ada kutipan, bukan pengulangan, satu sisi saja, dan maksimal 3 submission per market. X, Reddit, dan halaman berbayar wajib screenshot.
5. Kamu review. Approve / Reject / Edit.
6. Kalau lagi mode live, yang kamu Approve dikirim. Kuncinya idempotency disimpan dulu sebelum kirim, jadi kalau putus tinggal diulang dengan kunci yang sama.
7. Hasilnya nyimpan di `data/ledger.json` dan keliatan di tab Ledger.

Bukti untuk dua sisi market yang sama saling meniadakan. Fakta yang sudah pernah masuk tidak dapat apa-apa. Yang dikirim tidak bisa ditarik.

## Checklist kamu

Yang sudah beres:

- [x] Akun Delphi
- [x] Daftar di DoraHacks

Yang masih perlu kamu lakukan:

- [ ] Tanggal **26 Nov 2026, 00:00 WIB** (25 Nov 17:00 UTC), buka [https://api-access.delphi.fyi/](https://api-access.delphi.fyi/) dan buat API key. Simpan di tempat yang cuma kamu yang lihat.
- [ ] Isi file `.env` (langkahnya di bawah).
- [ ] Baca terms yang program ini tunjukin, lalu isi `ACCEPT_TERMS`.
- [ ] Gabung Discord: [https://discord.gg/SaCPyB4fZX](https://discord.gg/SaCPyB4fZX)
- [ ] KYC cuma kalau kamu menang. Jangan dilakukan sekarang.

Satu wallet saja. Jangan buat wallet kedua buat "tambah peluang".

## Pasang Node.js dan pnpm di Windows 11

1. Buka [https://nodejs.org](https://nodejs.org).
2. Unduh **Windows Installer (.msi)**, yang bertuliskan LTS. Versi 20 ke atas sudah cukup. Versi 22 juga boleh.
3. Jalankan installernya. Biarkan centang **Add to PATH**. Next terus sampai selesai.
4. Tutup semua jendela PowerShell atau Terminal yang sudah terbuka, lalu buka yang baru. Yang lama belum kenal Node.
5. Ketik, lalu Enter:

```powershell
node -v
```

Harus muncul `v20` atau lebih tinggi. Kalau muncul `v18` atau "not recognized", installer-nya belum masuk PATH. Ulangi langkah 2, atau restart laptop.

6. Masih di PowerShell yang sama:

```powershell
corepack enable
corepack prepare pnpm@10.33.4 --activate
pnpm -v
```

Kalau `corepack` ditolak, coba ini:

```powershell
npm install -g pnpm
pnpm -v
```

## Ambil folder programnya

Kalau kamu pakai git:

```powershell
git clone https://github.com/doydrop/agent-arena-miner.git
cd agent-arena-miner
```

Kalau kamu unduh ZIP dari GitHub: klik Code, Download ZIP, ekstrak, lalu buka folder itu. Di bilah alamat File Explorer ketik `powershell` lalu Enter. Jendela yang muncul sudah ada di folder yang benar.

## Jalan pertama (dry-run, tanpa API key)

```powershell
copy .env.example .env
pnpm install
pnpm start --dry-run
```

`pnpm start` saja juga dry-run. Sama saja.

Yang harus kamu lihat:

- Tulisan **TEST MODE — NOTHING IS SENT** dan **sample data, not a real market**.
- Empat kandidat. Yang kopi bertuliskan `needs screenshot`.
- Browser membuka `http://localhost:3737`. Kalau tidak, buka alamat itu sendiri.
- Kartu kopi: tombol Approve abu-abu. Tiga kartu lain: Approve hitam.
- Di setiap kartu dan di sisi kiri ada **3 kotak** (cap per market). Dua kotak terisi artinya 2 dari 3 submission sudah terpakai di data contoh.
- Ada tautan **Evidence PDF**. Itu lampiran 1 halaman. Dia ikut dihitung di batas 3 file.

Jendela terminal harus tetap terbuka. Ditutup, halamannya ikut mati.

Data contoh itu fiktif (Fictional City, Imaginary League, dan seterusnya). Bukan market Delphi. Tidak ada yang dikirim.

## Pakai halamannya

- **Approve** — di mode uji, keputusannya cuma tersimpan di komputer. Tidak terkirim.
- **Reject** — buang dari antrian. Tidak terkirim.
- **Edit** — ubah sisi, kutipan, tanggal, link, catatan, dan tempel screenshot (PNG atau JPG). Centang "Rebuild the note" biar catatan yang dikirim ikut kutipannya.
- **Full quote** — lihat catatan lengkap.
- **Evidence PDF** — buka lampiran. Isinya: market, sisi, URL, tanggal, kutipan, alasan singkat.
- **Ledger** — catatan, submission, vonis, dan hadiah. Angka di data contoh bukan uang beneran.
- **Rescan** — ulangi scan.
- **Cap** — tiga kotak per market. Kotak penuh = submission yang sudah terkirim. Kotak kosong = sisa jatah. Maksimal 3. Di mode uji, Approve tidak mengisi kotak, karena tidak ada yang terkirim.

Buat latihan: buka kartu kopi, Edit, lampirkan PNG, Save. Approve yang tadinya abu-abu jadi bisa ditekan. Tetap tidak ada yang terkirim.

Kalau antrian contohnya sudah berantakan:

```powershell
pnpm start --reset-sample
```

## PDF

Secara bawaan setiap draft dapat satu PDF. Dia dihitung sebagai satu file dari maksimal tiga.

Matikan di `.env`:

```text
ATTACH_EVIDENCE_PDF=false
```

Lalu jalankan ulang. Kalau sebuah draft sudah punya 3 file, PDF-nya tidak ditambahkan, dan halamannya menjelaskan kenapa.

## Besoknya, 26 Nov: isi .env

Buka file `.env` dengan Notepad. Jangan diganti namanya jadi `.env.txt`.

```text
DELPHI_API_ACCESS_KEY=tempel-di-sini
COMPETITION_SITE_URL=alamat-yang-ada-di-panduan-resmi
DELPHI_API_URL=https://api.delphi.fyi/v1
ACCEPT_TERMS=
```

- API key cuma ditaruh di sini. Jangan ditempel di chat, Discord, atau screenshot.
- `COMPETITION_SITE_URL` dan kadang `DELPHI_API_URL` baru pasti setelah panduan resmi terbit (25 Nov). Contohnya ada di `docs/ADAPTING.md`.
- Nama lama `DELPHI_API_KEY` tetap kebaca kalau `DELPHI_API_ACCESS_KEY` kosong.

Simpan. Tutup Notepad.

## Terima terms, lalu live

Terms diterima sekali per akun. Program ini tidak menerima terms diam-diam.

1. Isi API key dan URL market.
2. Jalankan `pnpm start --live`.
3. Kalau terms belum diterima, program mencetak URL dan nomor versinya, lalu **tidak mengirim**.
4. Buka URL itu, baca, lalu tulis nomor versinya di `.env`:

```text
ACCEPT_TERMS=nomor-yang-dicetak-program
```

5. Jalankan lagi `pnpm start --live`.
6. Di halaman, plaknya berubah jadi **LIVE — APPROVAL SENDS EVIDENCE**.
7. Approve pada draft yang lolos gate baru benar-benar mengirim. Tidak bisa ditarik.

Selama plaknya masih **TEST MODE — NOTHING IS SENT**, tidak ada submission yang pergi.

## Jadwal tiap pagi (jam 08:00)

Ini menjalankan dry-run. Tidak mengirim.

1. Buka PowerShell di folder program.
2. Kalau Windows menolak script, pakai perintah ini apa adanya:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\schedule-windows.ps1
```

3. Cek di Task Scheduler. Namanya `EvidenceMiningMorning`. Tiap hari 08:00.
4. Buat coba sekarang tanpa menunggu pagi, klik dua kali `scripts\run-dry-window.bat`.

Kalau halamannya sudah terbuka, jadwal pagi cuma menyuruh scan ulang. Tidak membuka program kedua.

Hapus jadwalnya:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-schedule-windows.ps1
```

Live tidak dijadwalkan. Kamu yang menekan Approve.

## Aturan main

- Kirim kutipan yang benar-benar ada di sumber publik.
- Satu sisi saja untuk tiap market.
- Maksimal 3 submission per market, maksimal 3 file (pdf, png, jpg, csv, txt).
- X, Reddit, dan halaman berbayar: tempel teks pentingnya dan lampirkan screenshot yang kelihatan URL-nya dan tanggalnya. Hakim tidak membuka browser.
- Jangan mengarang fakta. Kalau sumbernya tidak ketemu, draft itu tidak dibuat.
- Jangan pakai data pribadi orang privat.
- LLM opsional. Kosongkan `LLM_API_KEY` dan program tetap jalan. Kalau diisi, model cuma boleh mengutip kalimat yang memang ada di halaman.

## Perintah

| Perintah | Efek |
| --- | --- |
| `pnpm start` | Scan + halaman. Dry-run. |
| `pnpm start --dry-run` | Sama, ditulis lengkap. |
| `pnpm start --sample` | Paksa data contoh. |
| `pnpm start --reset-sample` | Kembalikan antrian contoh. |
| `pnpm start --live` | Approve mengirim, setelah terms diterima. |
| `pnpm start --no-open` | Jangan buka browser otomatis. |
| `pnpm feedback` | Tulis `data/feedback-draft.md` buat bounty umpan balik. |
| `pnpm test` | Tes aturan picker dan gate. |

Umpan balik ($250, kalau penyelenggara masih membukanya): isi file yang tertulis, jangan tempel API key, kirim lewat jalur yang mereka umumkan. `pnpm feedback --send` hanya menembak `DELPHI_FEEDBACK_URL` kalau variabel itu ada. Di SDK 2.4.0 belum ada endpoint umpan balik.

## Folder yang perlu kamu kenal

- `.env` — rahasia. Tidak ikut ke git.
- `data/` — antrian, ledger, PDF, screenshot. Tidak ikut ke git. Boleh dihapus kalau rusak; program membuatnya lagi.
- `data/last-run.txt` — teks terakhir di terminal, tanpa warna.
- `docs/ADAPTING.md` — kalau panduan resmi beda dengan kode ini, ubah di situ.
- `src/delphi/client.ts` — satu-satunya file yang bicara ke Delphi.

## TROUBLESHOOTING

Tiap gejala: artinya, lalu langkahnya. Jalankan perintah di folder program.

### `pnpm` is not recognized / `node` is not recognized

Node belum terpasang, atau jendela terminal-nya yang lama. Tutup, buka PowerShell baru, `node -v`. Kalau masih gagal, ulangi installer Node dan centang Add to PATH. Restart laptop kalau perlu.

### Execution policy / running scripts is disabled

Jangan ubah policy seumur hidup. Pakai sekali jalan:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\schedule-windows.ps1
```

### `Cannot find module` atau `tsx` tidak ketemu

```powershell
pnpm install
```

Harus di folder yang ada file `package.json`. Kalau `pnpm install` gagal di tengah, ulangi. Internetnya harus nyala.

### `EADDRINUSE` atau port 3737 sudah dipakai

Artinya programnya sudah jalan, atau program lain memegang port itu.

- Kalau halamannya masih bisa dibuka, pakai yang sudah terbuka.
- Kalau tidak, tutup jendela terminal yang lama.
- Atau di `.env` tulis `PORT=3738`, simpan, jalankan lagi, buka `http://localhost:3738`.

### Halaman kosong atau tidak kebuka

Salin alamat dari baris `Dashboard:` di terminal. Biasanya `http://127.0.0.1:3737`. Jangan tutup terminalnya. Coba browser lain. Kalau tetap kosong, lihat `data/last-run.txt`.

### Saya kira sudah terkirim, tapi tidak

Selama plaknya **TEST MODE — NOTHING IS SENT**, tidak ada POST. Ledger yang bertuliskan `dry_run` atau `Sample · not a payment` juga bukan kiriman. Kiriman beneran cuma ada setelah `pnpm start --live`, terms diterima, dan Approve pada draft yang bukan data contoh.

### Live ditolak: tidak ada API key

`.env` belum berisi `DELPHI_API_ACCESS_KEY`, atau file-nya salah nama (`.env.txt`). Notepad: Save as, tipe All Files, nama persis `.env`.

### 401 unauthorized

Key-nya salah, kepotong spasi, atau key mainnet dipakai di URL testnet (atau sebaliknya). Buat ulang key di halaman yang sesuai dengan `DELPHI_API_URL`. Panduan resminya yang menentukan pasangannya. Lihat `docs/ADAPTING.md`.

### 403 terms_not_accepted

Baca URL terms yang dicetak. Isi `ACCEPT_TERMS` dengan **versi yang sama persis**. Jalankan ulang `--live`.

### cap_reached

Market itu sudah 3 submission. Pilih market lain. Kotak cap yang penuh artinya jatahnya habis. Tidak bisa dihapus.

### Masih data contoh, padahal key sudah diisi

`COMPETITION_SITE_URL` masih kosong, atau situs market-nya tidak kebaca. Program jatuh ke data contoh dan menulis alasannya di terminal. Isi URL dari panduan resmi. Jangan pakai `--sample` kalau kamu mau market beneran. `--live` tidak mau jalan di atas data contoh.

### Needs a screenshot / Approve abu-abu

X, Reddit, atau halaman berbayar. Edit, lampirkan PNG/JPG yang kelihatan URL dan tanggalnya, Save. Approve terbuka kalau cek lain juga lolos. Tulisan di kartu menjelaskan yang kurang.

### Satu market dua sisi

Pilih satu. Kalau sisi yang satunya sudah terkirim, draft lawannya dikunci. Dua sisi di market yang sama saling meniadakan.

### Tidak ada draft sama sekali

Sumber gratisnya tidak punya kutipan bertanggal. Program tidak mengarang. Coba lagi nanti, atau Edit tidak akan muncul kalau memang tidak ada yang ditemukan. Cek internet.

### Task Scheduler jendelanya muncul sekilas lalu hilang

Itu normal kalau halamannya sudah terbuka: tugas pagi cuma menambahkan scan. Kalau ingin lihat tulisannya, klik dua kali `scripts\run-dry-window.bat`.

### SmartScreen atau Windows Defender

Node dan pnpm kadang ditanya sekali. Pilih More info, lalu Run, kalau yang kamu unduh memang installer dari nodejs.org. Jangan matikan antivirus.

### `EPERM` atau folder `data` tidak bisa dihapus

Tutup dulu programnya (terminal yang menjalankan `pnpm start`), baru hapus folder `data`.

### LLM error, padahal saya tidak pakai LLM

Biarkan `LLM_API_KEY` kosong. Error dari penyedia model tidak menghentikan mode biasa. Hapus isi `LLM_API_KEY` kalau kamu tidak memakainya.

### PDF tidak muncul

`ATTACH_EVIDENCE_PDF=false`, atau draft itu sudah 3 file. Di kartu ada kalimat "The PDF was skipped...". Hapus satu lampiran, atau set variabelnya `true`, lalu Rescan / jalankan ulang.

### Jam di kartu contoh tertulis WIB

Itu label data contoh (24 Nov 09:14 WIB), biar ceritanya tetap. Jam di terminal mengikuti jam laptop kamu.

### Ledger rusak / halaman aneh setelah diutak-atik

Tutup program. Hapus folder `data`. Jalankan `pnpm start --dry-run` lagi. Antrian contoh kembali. Kalau sudah live, menghapus `data` tidak menarik submission yang sudah terkirim ke Delphi. Itu cuma menghapus salinan di laptop.

## Kalau nanti ada error dan ga ada yang bantu

Kamu bisa tempel ini ke AI gratis mana saja (ChatGPT, Gemini, Claude, yang di browser):

1. Isi README ini (file `README.md`).
2. Isi `docs/ADAPTING.md` kalau errornya soal API Delphi.
3. Teks error apa adanya, dari terminal. Sekalian isi `data/last-run.txt` kalau ada.
4. Jangan tempel `.env`. Jangan tempel API key. Kalau tidak sengaja sudah terkirim, buat key baru di halaman Delphi dan anggap yang lama hangus.

Tulis di depannya, dalam bahasa kamu:

> Saya bukan programmer. Saya pakai Windows 11. Programnya Evidence Mining, folder yang ada `package.json`. Tolong kasih perubahan yang paling kecil. Jangan minta saya mengarang bukti. Dry-run harus tetap tidak mengirim apa-apa.

Kalau AI-nya kasih perintah, jalankan di folder yang sama, satu per satu. Kalau ada perintah yang menyuruh mengirim key atau menghapus `.env` tanpa salinan, jangan dilakukan.

## Lisensi

MIT. Font di `public/fonts` (Fraunces, Outfit, Great Vibes) berlisensi SIL Open Font License. Lihat `public/fonts/OFL.txt`.
