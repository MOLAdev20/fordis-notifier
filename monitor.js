const fs = require("fs");

// Masukkan semua kode_course matkul lu di sini
const COURSES = [
  "20261-07TPLE004-22TIF0382", // Keamanan Komputer
  "20261-07TPLE004-22TIF0392", // Jaringan Nirkabel
];

const JWT_TOKEN = process.env.MENTARI_TOKEN;
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const STATE_FILE = "./notified.json";

async function run() {
  console.log("=== MEMULAI MONITOR FORUM MENTARI ===");

  // Validasi Secret GitHub Actions
  if (!JWT_TOKEN) {
    console.error(
      "❌ ERROR: Secret MENTARI_TOKEN tidak ditemukan atau kosong!",
    );
    return;
  }
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    console.error(
      "❌ ERROR: Secret Telegram (TG_BOT_TOKEN / TG_CHAT_ID) belum lengkap!",
    );
    return;
  }

  // Baca daftar ID forum yang sudah pernah di-notif
  let notifiedIds = [];
  if (fs.existsSync(STATE_FILE)) {
    try {
      notifiedIds = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      console.log(`📁 Daftar forum yang sudah pernah dinotif:`, notifiedIds);
    } catch (e) {
      console.warn("⚠️ Gagal membaca notified.json, reset ke array kosong.");
      notifiedIds = [];
    }
  }

  let isUpdated = false;
  const now = new Date();

  for (const courseCode of COURSES) {
    const url = `https://mentari.unpam.ac.id/api/user-course/${courseCode}`;
    console.log(`\n🔍 Memeriksa matkul: ${courseCode}`);

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${JWT_TOKEN.trim()}`,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          Accept: "application/json",
          Origin: "https://mentari.unpam.ac.id",
          Referer: "https://mentari.unpam.ac.id/",
        },
      });

      console.log(`   ↳ Status HTTP Response: ${res.status} ${res.statusText}`);

      if (!res.ok) {
        const errorText = await res.text();
        console.error(
          `   ❌ [${courseCode}] Gagal request Mentari: ${errorText.slice(0, 150)}`,
        );
        continue;
      }

      const courseData = await res.json();
      const courseName = courseData.coursename || courseCode;
      console.log(`   ↳ Berhasil fetch data: "${courseName}"`);

      for (const section of courseData.data || []) {
        if (
          !section.kode_section ||
          !section.kode_section.startsWith("PERTEMUAN_")
        )
          continue;

        const forum = (section.sub_section || []).find(
          (sub) =>
            sub.kode_template === "FORUM_DISKUSI" || sub.tipe === "FORUM",
        );

        // Abaikan jika tidak ada fordis atau id-nya masih null (belum dibuat/dibuka)
        if (!forum || !forum.id) continue;

        const forumDate = new Date(forum.createdAt);
        const diffDays = (now - forumDate) / (1000 * 60 * 60 * 24);
        const alreadyNotified = notifiedIds.includes(forum.id);

        console.log(`   📌 [${section.nama_section}] Fordis ditemukan!`);
        console.log(`      • ID: ${forum.id}`);
        console.log(`      • Selesai (completion): ${forum.completion}`);
        console.log(
          `      • Umur forum: ${diffDays.toFixed(1)} hari yang lalu`,
        );
        console.log(`      • Pernah dinotif: ${alreadyNotified}`);

        // Syarat:
        // 1. Belum dikerjakan (completion === false)
        // 2. Dibuka dalam 14 hari terakhir (biar aman dari jeda libur/mingguan)
        // 3. Belum pernah dikirim notifikasi
        if (forum.completion === false && diffDays <= 14 && !alreadyNotified) {
          console.log(`      🚀 TRIGGER MATCH! Mengirim pesan ke Telegram...`);

          const cleanContent = (forum.konten || "")
            .replace(/<[^>]*>?/gm, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200);

          const message =
            `🚨 <b>FORUM DISKUSI DIBUKA!</b>\n\n` +
            `📚 <b>Matkul:</b> ${courseName}\n` +
            `📌 <b>Sesi:</b> ${section.nama_section}${section.nama_pertemuan ? ` - ${section.nama_pertemuan}` : ""}\n` +
            `📝 <b>Soal/ Topik:</b>\n<i>${cleanContent || "Tidak ada rincian konten."}...</i>\n\n` +
            `🔗 <a href="https://mentari.unpam.ac.id/u-courses/${courseCode}">Buka Mentari Sekarang</a>`;

          const sent = await sendTelegram(message);
          if (sent) {
            notifiedIds.push(forum.id);
            isUpdated = true;
            console.log(`      ✅ Sukses kirim notif ke Telegram!`);
          } else {
            console.log(`      ❌ Gagal kirim notif ke Telegram.`);
          }
        }
      }
    } catch (err) {
      console.error(
        `   ❌ Terjadi error pada matkul ${courseCode}:`,
        err.message,
      );
    }
  }

  // Simpan data ID jika ada yang baru dikirim
  if (isUpdated) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(notifiedIds, null, 2));
    console.log("\n💾 Berhasil mengupdate notified.json");
  } else {
    console.log("\nℹ️ Tidak ada notifikasi baru yang perlu dikirim.");
  }

  console.log("=== SELESAI ===");
}

async function sendTelegram(text) {
  const tgUrl = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: text,
        parse_mode: "HTML",
      }),
    });
    const result = await res.json();
    if (!result.ok) {
      console.error(`      ❌ Telegram API Error:`, result.description);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`      ❌ Gagal hit Telegram API:`, err.message);
    return false;
  }
}

run();
