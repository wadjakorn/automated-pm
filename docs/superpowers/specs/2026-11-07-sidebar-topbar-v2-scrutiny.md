# Scrutiny: Sidebar + top bar v2 (PM-0017…PM-0026) — 2026-11-07

ตรวจแบบคนนอกกับ `docs/superpowers/specs/2026-11-06-sidebar-topbar-v2-design.md` และ ticket ทั้ง 10 ใบ
โดยไล่ code จริง ไม่ได้อ่านแค่ spec

## 1. เจตนา

ทำให้ sidebar/top bar ใช้ได้จริงเมื่อมี project 20+ ตัว: จัดเรียงได้ในคลิกเดียว, ซ่อนแล้วไม่หาย,
รู้ตลอดว่าอยู่ project ไหน — โดยไม่แตะ data model/API

เจตนาชัด ทิศทางถูก แต่ plan **กว้างกว่าปัญหา** ในสองจุด (ข้อ 2) และมี claim ที่ชนกับ code จริง (ข้อ 3)

## 2. ทางที่ง่ายกว่า (ต้องตอบก่อนลงมือ)

### 2.1 มี "ที่สลับ project" ซ้อนกัน 5 ชั้น
หลัง plan นี้ ผู้ใช้จะสลับ project ได้จาก: (1) รายการใน sidebar, (2) popover จากชื่อบน header
(ticket G), (3) chip บน rail (ticket E), (4) ช่อง filter ใน sidebar (ticket F), (5) Ctrl+K palette ที่มีอยู่แล้ว
(`components/search-logic.ts:80-92` กระโดดไป project ได้) — ข้อ (2)(3)(4) เป็นของใหม่ทั้งหมดและทับกัน

เสนอ:
- **G = แสดงชื่ออย่างเดียว** คลิกชื่อบน desktop = กาง sidebar ถ้ายุบอยู่, บนมือถือ = เปิด drawer เดิม
  ไม่ต้องสร้าง popover switcher ใหม่
- **E (rail chips) เลื่อนเป็น low** — เมื่อ header มีชื่อ project แล้ว ปัญหา "rail ยุบแล้วไม่รู้ว่าอยู่ไหน" หาย
  ส่วน "สลับโดยไม่กาง" มี Ctrl+K อยู่แล้ว รอดูว่ายังคิดถึงไหม
- **F (filter) ตัดออกจาก v2** — palette ค้นได้อยู่แล้ว แค่เปลี่ยน placeholder ปุ่ม Search ให้บอกว่า
  "jump to a project" (ข้อนี้ 1 บรรทัด ย้ายไปอยู่ใน H)

### 2.2 bug P0 ถูกมัดรวมกับ feature ใหญ่
ticket A รวม "แก้ `move()` สลับกับตัวที่ซ่อน" (10 บรรทัด, ไม่พึ่งใบไหน) เข้ากับ drag-and-drop + คีย์ลัด +
optimistic state (หลายวัน, พึ่ง C และ D) ผลคือ bug เดียวในชุดที่เป็น **ความผิดพลาดจริง** ต้องรอ feature

เสนอ **PR เล็กก่อนทุกใบ ("v2.0")**:
- แก้ `move()`/`disabled` ให้คิดบนแถวที่ *กำลังแสดง* (`components/Sidebar.tsx:135-142, 257, 263`)
- B-lite: เมื่อกด Show hidden ให้เรียง hidden ไปท้ายรายการ, จำ toggle ใน localStorage,
  ถ้า project ที่เลือกถูกซ่อนให้เปิด toggle อัตโนมัติ (~20 บรรทัด ใน component เดิม)

ได้ 60% ของคุณค่าทั้ง plan ด้วย 5% ของความเสี่ยง แล้วค่อยทำ C → G → A → B เต็มรูปแบบ

## 3. สิ่งที่ claim ไม่ตรง code (เรียงตามความรุนแรง)

### [major] G: "sidebar ไม่ highlight บน /home /inbox" จะพัง theme และ `?project=` ถ้าทำด้วยการล้าง selectedId
- **หลักฐาน:** `components/Nav.tsx:51-57` ใช้ `selectedId` เลือก theme pack/accent ของ project;
  `Nav.tsx:71` และ `:94` ต่อ `?project=` จาก `selectedId` ให้ทุกลิงก์; `Home.tsx:41`, `Inbox.tsx:75`
  ส่ง `selectedId` เข้า AppShell เหมือนหน้าอื่น
- **ผล:** ถ้า G ทำให้ `/home` ไม่มี project ที่เลือก → สีธีมเด้งกลับ default ทุกครั้งที่เข้า My work
  และกด Board กลับมาจะเสีย project เดิม
- **แก้ใน ticket:** คง `selectedId` ไว้ทั้งหมด เพิ่ม prop `scope: "project" | "global"` จาก page →
  AppShell → Sidebar ใช้แค่เปลี่ยน *สไตล์* แถว active เป็นจาง (last used) และ header แสดง "My work"/"Inbox"

### [major] A + D: คีย์บอร์ดสองมาตรฐาน และ dnd-kit ชนกับ roving tabindex
- **หลักฐาน:** บอร์ดใช้ dnd-kit `KeyboardSensor` อยู่แล้ว (`components/Board.tsx:283-289`:
  Space จับ, ลูกศรย้าย, Enter ปล่อย) แต่ ticket A กำหนด `Alt+↑/↓` เป็นหลัก = convention ที่สองในแอปเดียว
  (ซึ่ง plan เองก็ตำหนิว่าแอปมี idiom เมนู 4 แบบ)
- `useSortable()` ของ dnd-kit คืน `attributes` ที่ใส่ `role="button"`, `tabIndex=0`,
  `aria-roledescription="sortable"` ให้ *ทุกแถว* → ขัดกับ ticket D (tab stop เดียว) และ
  `aria-current="page"` บนแถว
- **แก้ใน ticket:** A ใช้ `KeyboardSensor` + `sortableKeyboardCoordinates` ของ `@dnd-kit/sortable`
  และผูก `attributes`/`listeners` กับ grip ผ่าน `setActivatorNodeRef` (มีใน sortable v10 ที่ติดตั้ง)
  ไม่ใช่กับแถว; ตัด `Alt+↑/↓` ออก คง Move to top/bottom ในเมนู; D ระบุว่า roving tabindex ใช้กับ
  แถว ส่วน grip เป็น tab stop ของตัวเอง (ซ่อนจน focus)

### [minor] C: "เพิ่ม action ให้ Toast" — มีอยู่แล้ว
- **หลักฐาน:** `components/Toast.tsx:6-16` รับ `action: { label, onClick }` และค้าง 6 วินาที
  Sidebar แค่ไม่ได้เรียกใช้
- **แก้ใน ticket:** ตัดงาน Toast ออกจาก C เหลือ "เรียก `toast(text, kind, { label: "Undo", onClick })`"
  → undo ของ Hide/Archive/Trash ย้ายไปอยู่ใน PR v2.0 ได้เลย ไม่ต้องรอ popover

### [minor] A: reorder ส่งเฉพาะ id ที่ sidebar เห็น → project ที่ archive ไว้ได้ sort_order ชนกัน
- **หลักฐาน:** `lib/repo.ts:480-491` เขียน `sort_order = index` เฉพาะ id ที่ส่งมา; sidebar ได้รายการจาก
  `api.listProjects()` ซึ่ง `listProjects` ตัด archived ออก (`repo.ts:233-243`) → archived ค้างค่าเก่า
  พอ unarchive จะโผล่ตำแหน่งสุ่ม (bug เดิม ไม่ใช่ของ plan แต่ A เป็นที่เดียวที่จะแตะโค้ดนี้)
- **แก้ใน ticket:** ให้ server ต่อท้าย live id ที่ไม่อยู่ในลิสต์ (archived) ตามลำดับเดิม หรือ client ส่ง
  `includeArchived` list — เลือกฝั่ง server (ไม่ต้องแก้ CLI)

### [minor] A: นิยาม "แถวที่มองเห็น" ไม่ครอบคลุมช่วงก่อน B เสร็จ
- ก่อน B ships "Show hidden" ยังแทรก hidden ในรายการเดียวกัน; A ต้องระบุว่า "visible = แถวที่ render อยู่
  ขณะนั้น" (รวม hidden เมื่อ toggle เปิด) ไม่ใช่ `!p.hidden` เพื่อไม่ให้ลากแล้วกระโดดข้ามแถวที่เห็น

### [minor] G/H พูดถึง scope ของ Archive/Trash ไม่ตรงกัน
- **หลักฐาน:** `Archive.tsx:41`, `Trash.tsx:38` โหลด task ตาม `selectedId` → เป็นหน้าของ project
  (ส่วน "archived projects" ใน Archive เท่านั้นที่ global) — G จัดเป็น project-scoped (ถูก)
  แต่ H อ้าง review ว่า "ข้าม project" และเสนอ label "Workspace"
- **แก้ใน ticket:** H ตัดเหตุผล/label "Workspace" ออก คงเส้นคั่นเฉย ๆ

### [minor] รายการบน header มือถือถูกนิยามใน 3 ใบ (G, H, I) และไม่ตรง mockup
- mockup แสดง ⋯ เดียวรวม ⚙ + avatar บนมือถือ; H พูดถึง ⚙ และ avatar แยกกัน; I พูดถึง Logout/Theme
  เข้า avatar; G ตัด ☰ — ไม่มีใบไหนบอกว่าที่ 390px เหลืออะไรบ้าง
- **แก้ใน ticket:** เขียนรายการมือถือครั้งเดียวใน G: `ชื่อ project ▾ · 🔍 · Board · My work · Inbox · ⋯`
  และให้ H/I อ้างถึง

### [minor] G มือถือ: focus หลังปิด drawer จะหล่นไป body
- **หลักฐาน:** `components/AppShell.tsx:52-55` `closeMobile` คืน focus ไป `menuRef` ซึ่งผูกกับปุ่ม ☰
  (`Nav.tsx:113`); ถ้าแทนด้วยปุ่มชื่อ project ต้องย้าย ref ตาม — ใส่ใน acceptance ของ G

### [nit] B: Undo หลังซ่อน project ที่เปิดอยู่ ต้อง re-select ด้วย ไม่ใช่แค่ unhide
### [nit] I: Tailwind 3.4.19 ที่ติดตั้งมี `h-dvh` อยู่แล้ว — ตัด "tailwind.config.ts (ถ้าต้องเพิ่ม dvh)"
### [nit] E: โปรเจกต์ที่ `ticket_prefix` เป็น null ทั้งหมดถูกซ่อนอยู่ตอนนี้ แต่ chip ต้อง handle null (2 ตัวแรกของชื่อ) — ระบุแล้ว แค่ย้ำให้มี test

## 4. สิ่งที่ไล่แล้วยืนยันว่าถูก

- `move()` สลับใน full list และ `disabled` คิดจาก `fullIdx` (`Sidebar.tsx:135-142, 257, 263`) → bug จริง
- ทุกครั้งที่กด ↑/↓ ยิง `POST /api/projects/reorder` แล้ว `onProjectsChanged()` refetch ทั้งรายการ
  (`Sidebar.tsx:124-131`) → claim "21 คลิก = 21 round-trip" ถูก
- Inbox เป็นหน้าข้าม project จริง (`Inbox.tsx:33` เรียก `api.listInbox()` ไม่ส่ง project)
- `selectAfter` ไป `visible[0]` (`Sidebar.tsx:146-150`) ถูก
- header `<details>` ไม่ปิดด้วย Esc/คลิกนอก — วัดจริงใน DOM เมื่อ 2026-11-06
- `@dnd-kit/core ^6.3.1` + `@dnd-kit/sortable ^10` ติดตั้งแล้ว; `KeyboardSensor` ใช้บนบอร์ด
- CommandPalette มี pattern Esc/backdrop/`aria-activedescendant` (`CommandPalette.tsx:145-256`)
  ให้ลอกสำหรับ Menu แต่ไม่มี primitive เมนูใน `components/ui.tsx` (มีแค่ Spinner/Skeleton) →
  การสร้าง `Menu.tsx` ใน C สมเหตุสมผล

## 5. ลำดับที่เสนอใหม่

| ขั้น | งาน | ใบ |
|---|---|---|
| 0 | **PR v2.0**: แก้ `move()`/disabled บนแถวที่แสดง, hidden ไปท้าย + จำ toggle + auto-reveal, undo toasts ด้วย Toast action เดิม | แยกจาก A/B/C เป็นใบใหม่ หรือย้าย scope จาก A/B/C มา |
| 1 | C: Menu component (ตัดงาน Toast ออก) | PM-0018 |
| 2 | G: ชื่อ project บน header (แสดงอย่างเดียว + trigger drawer บนมือถือ; คง selectedId; ย้าย menuRef) | PM-0019 |
| 3 | A: DnD ด้วย dnd-kit KeyboardSensor, grip เป็น activator, server เติม archived ids | PM-0020 |
| 4 | B: Hidden section เต็มรูปแบบ (ต่อยอดจาก v2.0) | PM-0021 |
| 5 | H → D → I | PM-0024, PM-0022, PM-0026 |
| — | E เลื่อน low, F ตัดออก (เหลือ placeholder ปุ่ม Search ใน H) | PM-0023, PM-0025 |

## 6. สรุป

**fix-then-ship (plan):** ทิศทางถูกและ bug ที่ชี้เป็นของจริง แต่ต้อง (1) ดึง bug fix + B-lite ออกมาเป็น PR
เล็กก่อน (2) ตัด switcher ที่ซ้อนกัน (G popover, E, F) (3) แก้ G ไม่ให้ล้าง selectedId และ A/D ให้ใช้
คีย์บอร์ดมาตรฐานเดียวกับบอร์ด — สามข้อนี้เปลี่ยนสิ่งที่จะถูกสร้าง จึงควรแก้ ticket ก่อนย้ายเข้า todo
