const fs = require("fs");

// Masukkan semua kode_course matkul lu semester ini di sini
const COURSES = [
  "20261-07TPLE004-22TIF0382", // Keamanan Komputer
  "20261-07TPLE004-22TIF0392", // Jaringan Nirkabel
];

const JWT_TOKEN = process.env.MENTARI_TOKEN;
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const STATE_FILE = "./notified.json";

async function run() {
  // Baca daftar ID forum yang sudah pernah di-notif
  let notifiedIds = [];
  if (fs.existsSync(STATE_FILE)) {
    notifiedIds = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }

  let isUpdated = false;
  const now = new Date();

  for (const courseCode of COURSES) {
    const url = `https://mentari.unpam.ac.id/api/user-course/${courseCode}`;

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${JWT_TOKEN}`,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          Accept: "application/json",
          Origin: "https://mentari.unpam.ac.id",
          Referer: "https://mentari.unpam.ac.id/",
        },
      });

      if (!res.ok) {
        console.error(`[${courseCode}] HTTP Error: ${res.status}`);
        continue;
      }

      const courseData = await res.json();
      const courseName = courseData.coursename;

      for (const section of courseData.data || []) {
        if (!section.kode_section.startsWith("PERTEMUAN_")) continue;

        const forum = (section.sub_section || []).find(
          (sub) =>
            sub.kode_template === "FORUM_DISKUSI" || sub.tipe === "FORUM",
        );

        if (!forum || forum.id === null) continue;

        // Hitung selisih hari sejak forum dibuat/dibuka dosen
        const forumDate = new Date(forum.createdAt);
        const diffDays = (now - forumDate) / (1000 * 60 * 60 * 24);

        // Syarat kirim notif:
        // 1. Belum dikerjakan (completion === false)
        // 2. Baru dibuka dalam 7 hari terakhir (diffDays <= 7)
        // 3. Belum pernah dikirim notif sebelumnya (!notifiedIds.includes(forum.id))
        if (
          forum.completion === false &&
          diffDays <= 7 &&
          !notifiedIds.includes(forum.id)
        ) {
          const cleanContent = (forum.konten || "")
            .replace(/<[^>]*>?/gm, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200);

          const message =
            `🚨 <b>FORUM DISKUSI DIBUKA!</b>\n\n` +
            `📚 <b>Matkul:</b> ${courseName}\n` +
            `📌 <b>Sesi:</b> ${section.nama_section}${section.nama_pertemuan ? ` - ${section.nama_pertemuan}` : ""}\n` +
            `📝 <b>Soal/ Topik:</b>\n<i>${cleanContent}...</i>\n\n` +
            `🔗 <a href="https://mentari.unpam.ac.id/u-courses/${courseCode}">Buka Mentari Sekarang</a>`;

          const sent = await sendTelegram(message);
          if (sent) {
            notifiedIds.push(forum.id);
            isUpdated = true;
            console.log(
              `Notif terkirim: ${courseName} - ${section.nama_section}`,
            );
          }
        }
      }
    } catch (err) {
      console.error(`Error pada ${courseCode}:`, err.message);
    }
  }

  // Simpan perubahan ID ke notified.json
  if (isUpdated) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(notifiedIds, null, 2));
  }
}

async function sendTelegram(text) {
  const tgUrl = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const res = await fetch(tgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      text: text,
      parse_mode: "HTML",
    }),
  });
  return res.ok;
}

run();
