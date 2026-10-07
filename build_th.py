#!/usr/bin/env python3
"""Build the Thai waitlist version of challenge.yaru.ai from the original English bundle.

Reads source/ (original English index.html + JS/CSS bundle, never edited),
writes public/index.html + public/assets/index-th.js + public/assets/index-th.css.

    python3 build_th.py
"""
import re, json, pathlib, sys

ROOT = pathlib.Path(__file__).parent
SRC, OUT = ROOT / "source", ROOT / "public"
js = (SRC / "index-DQqFpzXo.js").read_text()
css = (SRC / "index-K9wBeB5c.css").read_text()

# ---------------------------------------------------------------------------
# 1. Text: English string literal -> Thai
#    Analytics ids (content_id:"...") are deliberately left in English.
# ---------------------------------------------------------------------------
T = {
    # Loading / nav
    "Loading Yaru Create...": "กำลังโหลด Yaru Create...",
    "Join Free": "ซื้อคอร์ส",
    # Hero
    "FREE 5-Day Challenge": "ชาเลนจ์ 5 วัน · ราคาพิเศษช่วงเปิดตัว",
    "Launch a product idea in 5 days with AI.": "นำไอเดียของคุณออกมาหารายได้ภายใน 5 วัน ด้วย AI",
    "No code. No experience. No excuses. Pick your idea, start building, and get it in front of real people. In a week, for free.":
        "ไม่ต้องเขียนโค้ด ไม่ต้องมีประสบการณ์ ไม่มีข้ออ้าง เลือกไอเดีย ลงมือสร้าง แล้วนำไปให้คนได้เห็นจริง ภายใน 1 สัปดาห์",
    "Join the Free Challenge": "ซื้อคอร์สราคาพิเศษ",
    "See What's Inside": "ดูว่ามีอะไรบ้าง",
    # Tools strip
    "Build with the world's leading AI tools": "สร้างด้วยเครื่องมือ AI ชั้นนำของโลก",
    # What you'll walk away with
    "What You'll Walk Away With": "สิ่งที่คุณจะได้รับ",
    "Five days. One idea. Launch a product idea.": "ห้าวันกับหนึ่งไอเดีย เปิดตัวไอเดียของคุณสู่ตลาด",
    "A real business idea. Chosen.": "ไอเดียธุรกิจที่คัดเลือกมาให้คุณเลือกแล้ว (หรือใช้ไอเดียของตัวเองได้)",
    "Browse 100+ vetted AI business ideas or use our AI generator to find one that genuinely excites you. No more overthinking. One idea. One direction.":
        "เลือกดูไอเดียธุรกิจ AI ที่คัดสรรแล้วกว่า 100 ไอเดีย หรือใช้ตัวช่วยสร้างไอเดียด้วย AI ของเรา เพื่อหาไอเดียที่คุณตื่นเต้นจริงๆ เลิกคิดมาก หนึ่งไอเดีย หนึ่งทิศทาง",
    "A product idea you've actually launched.": "เราจะสอนให้คุณนำไอเดียธุรกิจของคุณไปเปิดตัวได้จริงๆ",
    "You'll pick a no-code AI tool and start building. For real. Not a mock-up sitting on your hard drive. Something live, with a real URL, in front of real people.":
        "คุณจะได้เลือกเครื่องมือ AI แบบไม่ต้องเขียนโค้ด แล้วเริ่มสร้างจริง ไม่ใช่แค่ม็อกอัปที่เก็บไว้ในเครื่อง แต่เป็นของที่ใช้งานได้จริง มี URL จริง และอยู่ต่อหน้าคนจริง",
    "Real validation from real people.": "ช่วยให้คุณพิสูจน์ไอเดียของคุณกับคนจริงๆ",
    "You'll get your idea in front of an audience and collect real signal, proving someone other than you believes in it.":
        "คุณจะได้นำไอเดียไปให้กลุ่มเป้าหมายเห็น และเก็บสัญญาณตอบรับจริง เพื่อพิสูจน์ว่ามีคนอื่นนอกจากคุณที่เชื่อในไอเดียนี้",
    "A clear path forward.": "วางแผนการตลาดและเส้นทางต่อไป",
    "After five days you'll know exactly what it takes to go from challenge to full launch, and whether Yaru Create is your next step.":
        "หลังจากห้าวัน คุณจะรู้ชัดว่าต้องทำอะไรบ้างเพื่อไปจากชาเลนจ์สู่การเปิดตัวเต็มรูปแบบ และ Yaru Create ใช่ก้าวต่อไปของคุณหรือไม่",
    # Why most people never start
    "Why Most People Never Start": "ทำไมคนส่วนใหญ่ไม่เคยได้เริ่ม",
    "The problem isn't motivation.": "ปัญหาไม่ใช่แรงจูงใจ",
    "It's the first step.": "แต่คือก้าวแรก",
    "Here's what stops people before they even begin, and how the 5-Day Challenge solves each one.":
        "โดยรวมแล้วนี่คือสิ่งที่ทำให้หลายคนหยุดก่อนที่จะเริ่มต้นได้ด้วยซ้ำ และนี่คือวิธีที่ชาเลนจ์ 5 วันของเราช่วยให้คุณแก้ไขปัญหานี้ได้",
    "Too many ideas. None of them feel right.": "ไอเดียเยอะไปหมดเลย แต่ไม่มีอันไหนที่รู้สึกว่าใช่",
    "SaaS for dog walkers. Productivity apps for remote teams. AI chatbots for restaurants. Complexity of choice causes paralysis. Overwhelm causes inaction.":
        "SaaS สำหรับคนรับพาสุนัขเดินเล่น แอปเพิ่มประสิทธิภาพสำหรับทีมที่ทำงานทางไกล แชตบอต AI สำหรับร้านอาหาร ตัวเลือกที่มากเกินไปทำให้ตัดสินใจไม่ได้ ความรู้สึกท่วมท้นทำให้ไม่ได้ลงมือทำ",
    "You research instead of build.": "ขอหาข้อมูลก่อนนะ แทนที่จะลงมือสร้างเลย และหาความรู้โดยการกระทำ",
    "Weeks pass. Nothing ships. The gap between thinking and doing keeps growing.":
        "หลายสัปดาห์ผ่านไป ยังไม่มีอะไรออกมา ช่องว่างระหว่างการคิดกับการลงมือทำก็ยิ่งห่างออกไป",
    "Day 1 fixes this.": "เราช่วยคุณแก้ไขปัญหาอันนี้ได้ตั้งแต่วันที่ 1 แล้ว",
    "One idea. Chosen. Done. We give you the tools to pick and commit in hours, not weeks.":
        "หนึ่งไอเดีย เลือกแล้ว จบ เราให้เครื่องมือที่ช่วยให้คุณเลือกและตัดสินใจได้ในไม่กี่ชั่วโมง ไม่ใช่หลายสัปดาห์",
    "Joshua Maddox, CEO Yaru": "Will Lin, COO ของ Yaru",
    # Who it's for
    "This Challenge Was Built for You. If...": "ชาเลนจ์นี้สร้างมาเพื่อคุณ ถ้า...",
    "You've been thinking about building something for months. But haven't started.":
        "ถ้าคุณเคยคิดอยากจะสร้างอะไรสักอย่างมาสักพักแล้ว และยังไม่เคยได้เริ่ม",
    "The challenge gives you a deadline, a structure, and a community. You won't have a choice but to start.":
        "ชาเลนจ์นี้ให้ทั้งเส้นตาย โครงสร้าง และคอมมูนิตี้ คุณจะไม่มีทางเลือกอื่นนอกจากต้องเริ่ม",
    "You have no idea how to code. And you don't need to.": "ถ้าคุณไม่มีความรู้เกี่ยวกับการทำเว็บไซต์ โดยเฉพาะการเขียนโค้ด",
    "Every tool we use in this challenge requires zero coding. If you can type, you can build.":
        "ทุกเครื่องมือที่เราใช้ในชาเลนจ์นี้ไม่ต้องเขียนโค้ดเลย ถ้าคุณพิมพ์ได้ คุณก็สร้างได้",
    "You're not sure what to build yet.": "คุณยังไม่แน่ใจว่าอยากจะสร้างอะไรให้ตัวเอง",
    "Day 1 is literally about finding your idea. We have 100+ vetted options and an AI interview tool to help you choose.":
        "วันที่ 1 คือการหาไอเดียของคุณโดยเฉพาะ เรามีตัวเลือกที่คัดสรรแล้วกว่า 100 ไอเดีย และเครื่องมือสัมภาษณ์ด้วย AI ที่ช่วยให้คุณเลือกได้",
    "You want to see what's actually possible before you commit to anything bigger.":
        "ถ้าคุณอยากเห็นด้วยตัวเองว่าอะไรเป็นไปได้จริง ก่อนที่จะลงทุนแรงและเวลาของตัวเองเต็มที่",
    "Five days is the perfect test run. Launch a real idea, validate it with real people, then decide your next move.":
        "ห้าวันคือการทดลองที่สมบูรณ์แบบ เปิดตัวไอเดียจริง พิสูจน์กับคนจริง แล้วค่อยตัดสินใจก้าวต่อไป",
    "You don't need experience. You don't need money. You don't need a plan. You just need to show up for five days.":
        "คุณไม่ต้องมีประสบการณ์ ไม่ต้องมีเงินทุนก้อนใหญ่ ไม่ต้องมีแผน แค่มาให้ครบห้าวันก็พอ",
    # Day by day
    "Day 1": "วันที่ 1", "Day 2": "วันที่ 2", "Day 3": "วันที่ 3", "Day 4": "วันที่ 4", "Day 5": "วันที่ 5",
    "The Idea.": "ไอเดีย",
    "Stop overthinking. Pick one idea you're excited about. That's the whole day.":
        "เลิกคิดมาก เลือกไอเดียเดียวที่คุณตื่นเต้น แค่นั้นแหละคือทั้งวัน",
    "The Tools.": "เครื่องมือ",
    "The Yaru team walks you through the top no-code AI build tools. Pick one. Start building.":
        "ทีม Yaru จะพาคุณไปรู้จักเครื่องมือ AI แบบไม่ต้องเขียนโค้ดที่ดีที่สุด เลือกมาหนึ่งอย่าง แล้วเริ่มสร้าง",
    "Validate It.": "พิสูจน์ไอเดีย",
    "Learn the smartest way to test your idea in the market before you invest months building it.":
        "เรียนรู้วิธีที่ฉลาดที่สุดในการทดสอบไอเดียกับตลาด ก่อนจะลงทุนเวลาหลายเดือนสร้างมันขึ้นมา",
    "Launch It.": "เปิดตัว",
    "Put your idea in front of real people. Get real signal. See if it lands.":
        "นำไอเดียไปให้คนจริงได้เห็น รับสัญญาณตอบรับจริง แล้วดูว่าโดนใจหรือไม่",
    "Follow Through.": "ไปต่อให้สุด",
    "You've done more in five days than most do in months. Now find out what comes next.":
        "ในห้าวัน คุณทำได้มากกว่าที่คนส่วนใหญ่ทำในหลายเดือน ทีนี้มาดูกันว่าก้าวต่อไปคืออะไร",
    "The 5-Day Challenge: Day by Day": "แต่ละวันใน Challenge 5 วัน",
    "Every day has one clear goal and one clear outcome. No overwhelm. Just momentum.":
        "ทุกวันมีเป้าหมายที่ชัดเจนหนึ่งอย่าง และผลลัพธ์ที่ชัดเจนหนึ่งอย่าง ไม่หนักเกินไป มีแต่แรงผลักดัน",
    # About
    "About Yaru": "เกี่ยวกับ Yaru",
    "Joshua Maddox and the Yaru team": "Will Lin ระหว่างเวิร์กช็อปของ Yaru",
    "We don't teach theory. We build in public.": "เราไม่สอนทฤษฎี เราลงมือสร้างเป็นเพื่อนคุณเลย",
    "Yaru builds real-world products and services using the latest AI tools, brings them to market, and documents exactly what's working and what isn't. Then we bring those lessons (the honest ones, not the hype) directly to you.":
        "Yaru สร้างผลิตภัณฑ์และบริการที่ใช้งานได้จริงด้วยเครื่องมือ AI ล่าสุด นำออกสู่ตลาด และบันทึกอย่างละเอียดว่าอะไรได้ผลและอะไรไม่ได้ผล จากนั้นเราก็นำบทเรียนเหล่านั้น (บทเรียนที่จริงใจ ไม่ใช่กระแส) มาถ่ายทอดให้คุณโดยตรง",
    "We tested Yaru ourselves before we launched it. We invited people to live learning sessions in multiple cities. They showed up. We repeated the test. There was clear signal. That's exactly the process we'll teach you in Day 3 of this challenge.":
        "เราทดสอบ Yaru ด้วยตัวเองก่อนเปิดตัว เราเชิญผู้คนมาร่วมเซสชันการเรียนรู้สดในหลายเมือง พวกเขามากันจริง เราทดสอบซ้ำ และได้สัญญาณตอบรับที่ชัดเจน นี่คือกระบวนการเดียวกับที่เราจะสอนคุณในวันที่ 3 ของชาเลนจ์นี้",
    "AI is simultaneously overhyped and underutilised. There are a lot of people online promising the world. We're not one of them. We show you what's actually working, through building, not talking.":
        "AI ถูกพูดถึงเกินจริง และในขณะเดียวกันก็ถูกใช้น้อยเกินไป มีคนมากมายบนโลกออนไลน์ที่สัญญาว่าจะให้ทุกอย่าง แต่เราไม่ใช่หนึ่งในนั้น เราแสดงให้คุณเห็นว่าอะไรได้ผลจริง ผ่านการลงมือสร้าง ไม่ใช่แค่พูด",
    "CEO, Yaru": "COO ของ Yaru",
    "Joshua Maddox": "Will Lin",
    "JM": "WL",
    # Final CTA
    "The builders who share consistently are the ones who keep building.":
        "ขอแค่ว่าคุณเป็นคนที่พยายามอย่างสม่ำเสมอ นี่แหละคือคนที่จะสามารถก้าวต่อไปได้เรื่อยๆ กับ AI",
    "In five days you'll do more than most people do in months of thinking about it. AI is changing everything. Don't deal with it by watching from the sidelines.":
        "ในห้าวัน คุณจะทำได้มากกว่าที่คนส่วนใหญ่ทำในหลายเดือนที่เอาแต่คิด AI กำลังเปลี่ยนทุกอย่าง อย่ารับมือกับมันด้วยการยืนดูอยู่ข้างสนาม",
    "Join the Free 5-Day Challenge": "ซื้อคอร์สชาเลนจ์ 5 วัน",
    "No credit card. No experience required. Just show up for five days.":
        "ไม่ต้องมีประสบการณ์ แค่มาให้ครบห้าวัน",
    # Signup
    "100% free. No credit card required.": "ชำระเงินอย่างปลอดภัยผ่าน Beam",
    "5 short daily emails with video walkthroughs": "อีเมลสั้นๆ วันละฉบับ 5 วัน พร้อมวิดีโอแนะนำทีละขั้นตอน",
    "Access to 100+ vetted AI business ideas": "เข้าถึงไอเดียธุรกิจ AI ที่คัดสรรแล้วกว่า 100 ไอเดีย",
    "AI tools to generate your idea and validate it fast": "เครื่องมือ AI ที่ช่วยสร้างไอเดียและพิสูจน์ไอเดียได้อย่างรวดเร็ว",
    "A private community of builders doing it alongside you": "คอมมูนิตี้ส่วนตัวของเหล่านักสร้างที่ลงมือทำไปพร้อมกับคุณ",
    "Join Free Today": "ซื้อคอร์สราคาพิเศษ",
    "Ready to stop thinking and start building?": "พร้อมจะเลิกหาข้อมูล แล้วมาเริ่มลงมือสร้างไปด้วยกันหรือยัง?",
    "Enter your name and email. Day 1 of the challenge hits your inbox immediately. Five days from now you'll have a launched idea in front of real people.":
        "เลือกแพ็กเกจ กรอกชื่อและอีเมล แล้วชำระเงินได้ทันทีผ่าน Beam ตอนนี้แพ็กเกจพื้นฐานและ VIP อยู่ในราคาพิเศษช่วงเปิดตัว",
    "You're in the challenge!": "ชำระเงินเรียบร้อย ยินดีต้อนรับ!",
    "Check your inbox. Day 1 is already on its way. Your journey from idea to launch starts now.":
        "ขอบคุณที่ซื้อคอร์สชาเลนจ์ 5 วันกับ Yaru เราจะส่งรายละเอียดการเริ่มต้นให้คุณทางอีเมลเร็วๆ นี้ การเดินทางจากไอเดียสู่การเปิดตัวของคุณเริ่มต้นแล้ว",
    "Don't see it? Check your spam folder and mark us as safe.":
        "ถ้าไม่เห็นอีเมลจากเรา ลองเช็กโฟลเดอร์สแปม แล้วทำเครื่องหมายว่าเราเป็นผู้ส่งที่ปลอดภัย",
    "Day 1 goes to your inbox immediately.": "กรอกข้อมูล แล้วไปชำระเงินที่หน้าชำระเงินของ Beam",
    "First Name": "ชื่อจริง",
    "Your first name": "ชื่อจริงของคุณ",
    "Email Address": "อีเมล",
    "Your email address": "อีเมลของคุณ",
    "Signing you up...": "กำลังไปหน้าชำระเงิน...",
    "Start the Free Challenge": "ซื้อคอร์สและชำระเงิน",
    "No spam. No credit card. Unsubscribe any time.": "ชำระเงินอย่างปลอดภัยผ่าน Beam · ไม่มีสแปม",
    "Something went wrong": "เกิดข้อผิดพลาด",
    "There was an issue signing you up. Please try again.": "ไม่สามารถไปหน้าชำระเงินได้ กรุณาลองใหม่อีกครั้ง",
    # 404
    "404 Page Not Found": "404 ไม่พบหน้านี้",
    "Did you forget to add the page to the router?": "ไม่พบหน้าที่คุณกำลังค้นหา",
}

# Template literals (backticks) — exact text inside the backticks.
T_BACKTICK = {
    'Most people spend months "thinking about" starting something. You\'ll have a real idea launched and in front of real people before the week is out.':
        'คนส่วนใหญ่ใช้เวลาหลายเดือนแค่ "คิดจะ" เริ่มทำอะไรสักอย่าง แต่คุณจะได้เปิดตัวไอเดียจริง และนำไปให้คนได้เห็นจริงก่อนสัปดาห์นี้จะจบ',
    '"We see this a lot. Someone posts in a forum: \'I spent months building an AI startup and no one uses it.\' The mistake? They built first instead of validating first."':
        '"นับครั้งไม่ถ้วนแล้วที่ผมได้เจอคนที่เคยเอ่ยปากว่าอยากมีอะไรเป็นของตัวเอง หรืออยากเริ่มธุรกิจของตัวเอง แต่ไม่ยอมลงมือทำ"',
    '"You started this challenge five days ago. Today you have something live that real people can sign up for." That\'s what Day 5 looks like.':
        '"คุณเริ่มชาเลนจ์นี้เมื่อห้าวันก่อน วันนี้คุณมีของที่ใช้งานได้จริง ให้คนจริงสมัครใช้ได้แล้ว" นี่คือหน้าตาของวันที่ 5',
}

# Nav: keep English names (used for analytics ids), add Thai label for display.
NAV = {"The Challenge": "ชาเลนจ์", "5 Days": "5 วัน", "Who It's For": "เหมาะกับใคร", "About Yaru": "เกี่ยวกับ Yaru"}

# ---------------------------------------------------------------------------
# Thai line-breaking fixes. Browsers split some loanwords mid-word (ไอ|เดีย),
# so glue their grapheme clusters with WORD JOINER; keep numbers with their unit.
# ---------------------------------------------------------------------------
# Sukhumvit Set renders U+00A0 with zero width, so a kept-together space is
# WJ + space + WJ. Glued words get ZWSP on Thai-adjacent sides so the break
# opportunities *between* words survive.
WJ, ZWSP = "⁠", "​"
MARK = "\ue000"  # kept-together space -> rendered as a nowrap <span>
GLUE = ["ไอเดีย", "ชาเลนจ์", "คอมมูนิตี้", "ม็อกอัป", "สตาร์ทอัพ", "แชตบอต", "เซสชัน",
        "ฟอรัม", "โฟลเดอร์", "สแปม", "อีเมล", "ข้ออ้าง", "โค้ด", "ความช่วยเหลือ", "รายได้", "สู่ตลาด", "ตัวเอง"]
THAI = re.compile(r"[฀-๿]")
THAI_MARKS = set(chr(c) for c in [0x0E31, *range(0x0E34, 0x0E3B), *range(0x0E47, 0x0E4F)])

def clusters(word):
    out = []
    for ch in word:
        if out and ch in THAI_MARKS:
            out[-1] += ch
        else:
            out.append(ch)
    return out

def thai_fix(s):
    for w in GLUE:
        glued = WJ.join(clusters(w))
        out, i = [], 0
        while (j := s.find(w, i)) != -1:
            out.append(s[i:j])
            if j > 0 and THAI.match(s[j - 1]):
                out.append(ZWSP)
            out.append(glued)
            k = j + len(w)
            if k < len(s) and THAI.match(s[k]) and s[k] not in THAI_MARKS:
                out.append(ZWSP)
            i = k
        out.append(s[i:])
        s = "".join(out)
    s = re.sub(r"(\d+) (วัน|ไอเดีย|สัปดาห์)", r"\1" + MARK + r"\2", s)   # 5 วัน, 100 ไอเดีย, 1 สัปดาห์
    s = re.sub(r"(วันที่) (\d)", r"\1" + MARK + r"\2", s)         # วันที่ 1
    return s

KEEP = re.compile(r"(\d+\ue000(?:วัน|ไอเดีย|สัปดาห์)|วันที่\ue000\d)")

def js_lit(s):
    """Thai string -> JS expression. Kept-together pairs become nowrap spans."""
    if MARK not in s:
        return json.dumps(s, ensure_ascii=False)
    parts = []
    for i, piece in enumerate(KEEP.split(s)):
        if not piece:
            continue
        if i % 2:
            parts.append('m.jsx("span",{style:{whiteSpace:"nowrap"},children:%s})'
                         % json.dumps(piece.replace(MARK, " "), ensure_ascii=False))
        else:
            parts.append(json.dumps(piece, ensure_ascii=False))
    return "[" + ",".join(parts) + "]"

T = {k: thai_fix(v) for k, v in T.items()}
T_BACKTICK = {k: thai_fix(v) for k, v in T_BACKTICK.items()}
NAV = {k: thai_fix(v) for k, v in NAV.items()}

def sub_exact(src, old, new, count=None):
    n = src.count(old)
    if n == 0 or (count is not None and n != count):
        sys.exit(f"patch failed ({n} hits): {old[:80]!r}")
    return src.replace(old, new)

# Hero: drop the "100% free" footnote
js = sub_exact(js, ',m.jsx("p",{className:"text-sm opacity-70",children:"100% free. No credit card. Just five days of building."})', "", 1)
# Day 1 and Day 3 carousel cards get photos like the other days
js = sub_exact(js, 'type:"red",background:"bg-primary"}', 'type:"image",backgroundImage:"/assets/day1-idea.jpg"}', 1)
js = sub_exact(js, 'type:"dark",background:"bg-foreground"}', 'type:"image",backgroundImage:"/assets/day3-validate.jpg"}', 1)

# Sign-up form -> checkout. One POST to our own /api/checkout (no Circle community add),
# carrying UTM params + referrer so TikTok/other ad traffic can be told apart.
js = sub_exact(js,
    'fetch("/api/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:t.name,email:t.email,interest:"challenge",motivation:"5-day challenge signup",linkedin:"",twitter:"",tiktok:"",fellowship:"not-sure"})}),fetch("/api/circle/add-contact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({firstName:c,email:t.email})}).catch(p=>console.warn("Circle add-contact error (non-blocking):",p))',
    'fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:t.name,email:t.email,params:Object.fromEntries(new URLSearchParams(location.search)),referrer:document.referrer})})',
    1)
# Keep Thai waitlist conversions separate from English course sign-ups in GTM / Meta
js = sub_exact(js, 'event:"generate_lead",currency:"USD",value:997,lead_source:"subscribe_widget"',
               'event:"begin_checkout",lead_source:"checkout_th"', 1)
js = sub_exact(js, 'content_name:"Course Sign Up",status:"registered"',
               'content_name:"TH 5-Day Challenge Checkout",status:"checkout_started"', 1)

# Paid course: three packages. Shown as cards in the sign-up section and chosen on
# the form (saved with the sign-up as "basic" / "vip" / "coaching").
PLANS = [
    {"name": "พื้นฐาน", "note": "คอร์สชาเลนจ์ 5 วัน", "was": "฿6,000", "price": "฿3,990", "unit": "", "tag": "ราคาพิเศษช่วงเปิดตัว"},
    {"name": "VIP", "note": "คอร์สชาเลนจ์ 5 วัน แบบ VIP", "was": "฿12,990", "price": "฿9,990", "unit": "", "tag": "ราคาพิเศษช่วงเปิดตัว"},
    {"name": "โค้ชชิ่งแบบตัวต่อตัว", "note": "One-on-One Coaching", "was": "", "price": "฿250,000", "unit": "/ เดือน", "tag": ""},
]
PKG_CHOICES = [["basic", "พื้นฐาน", "฿3,990"], ["vip", "VIP", "฿9,990"], ["coaching", "โค้ชชิ่งตัวต่อตัว", "฿250,000 / เดือน"]]
LINE_TAG_ID = "34e8f29d-a401-4dcc-b551-e49132bbd5d4"
J = lambda o: json.dumps(o, ensure_ascii=False)
js = sub_exact(js, 'm.jsx("ul",{className:"space-y-3",children:X1.map(',
    'm.jsx("div",{className:"yt-plans",children:' + J(PLANS) + '.map(p=>m.jsxs("div",{className:"yt-plan",children:['
    'm.jsxs("div",{className:"yt-plan-info",children:[m.jsx("div",{className:"yt-plan-name",children:p.name}),'
    'm.jsx("div",{className:"yt-plan-note yt-thin",children:p.note}),'
    'p.tag&&m.jsx("div",{className:"yt-plan-tag",children:p.tag})]}),'
    'm.jsxs("div",{className:"yt-plan-prices",children:[p.was&&m.jsx("s",{className:"yt-was yt-thin",children:p.was}),'
    'm.jsxs("div",{className:"yt-price",children:[p.price,p.unit&&m.jsx("span",{className:"yt-unit yt-thin",children:" "+p.unit})]})]})]},p.name))}),'
    'm.jsx("ul",{className:"space-y-3",children:X1.map(', 1)
js = sub_exact(js, 'v.useState({name:"",email:""})', 'v.useState({name:"",email:"",pkg:"basic"})', 1)
js = sub_exact(js, 'n({name:"",email:""})', 'n({name:"",email:"",pkg:"basic"})', 1)
# LINE Tag conversion: fired the moment someone clicks the pay button (form submit),
# whether or not they finish paying. The redirect to Beam waits 400ms so the LINE
# beacon has time to leave the page.
js = sub_exact(js, 'u.preventDefault(),o(!0);',
               'u.preventDefault(),o(!0);window._lt&&window._lt("send","cv",{type:"Conversion"},["' + LINE_TAG_ID + '"]);', 1)
# On success the server returns Beam's payment-link URL: send the buyer there (no toast,
# no "you're in" card). Beam sends them back to /?payment=success, which shows the
# thank-you card and scrolls to it.
js = sub_exact(js, 's(!0),window.dataLayer=window.dataLayer||[]', 'const _ck=await f.json();window.dataLayer=window.dataLayer||[]', 1)
js = sub_exact(js, 'e({title:"You\'re in!",description:"Check your email. Day 1 is on its way."}),n({name:"",email:"",pkg:"basic"})',
               'setTimeout(()=>window.location.assign(_ck.url),400)', 1)
js = sub_exact(js, '[i,s]=v.useState(!1),l=async u=>',
               '[i,s]=v.useState(()=>new URLSearchParams(location.search).get("payment")==="success"),l=async u=>', 1)
js = sub_exact(js, ',[u]:c}))};return m.jsx("section",{id:"signup"',
               ',[u]:c}))};v.useEffect(()=>{if(i){setTimeout(()=>{const el=document.querySelector("#signup h3")||document.getElementById("signup");el&&el.scrollIntoView({block:"center"})},400)}},[]);return m.jsx("section",{id:"signup"', 1)
js = sub_exact(js, 'body:JSON.stringify({name:t.name,email:t.email,params', 'body:JSON.stringify({name:t.name,email:t.email,package:t.pkg,params', 1)
js = sub_exact(js, 'm.jsx(mn,{type:"submit"',
    'm.jsxs("div",{className:"space-y-2",children:[m.jsx(ca,{children:' + J("เลือกแพ็กเกจที่สนใจ") + '}),'
    'm.jsx("div",{className:"yt-pkgs",role:"radiogroup",children:' + J(PKG_CHOICES) + '.map(([k,l,d])=>m.jsxs("label",{className:"yt-pkg"+(t.pkg===k?" yt-pkg-on":""),children:['
    'm.jsx("input",{type:"radio",name:"pkg",value:k,checked:t.pkg===k,onChange:()=>a("pkg",k),className:"sr-only"}),'
    'm.jsx("span",{className:"yt-pkg-name",children:l}),m.jsx("span",{className:"yt-pkg-desc yt-thin",children:d})]},k))})]}),'
    'm.jsx(mn,{type:"submit"', 1)

# About section photo: Will Lin (white cap) working with an attendee. The frame is
# 4:3 (not the original tall 480px box) so both faces fit in the landscape photo.
js = sub_exact(js, 'Q1="/assets/new_graduate_image-D46KU05m.jpeg"', 'Q1="/assets/about-will-cap.jpg"', 1)
js = sub_exact(js, 'className:"rounded-2xl w-full max-w-md h-[480px] object-cover object-top","data-testid":"img-history-collaboration"',
               'className:"rounded-2xl w-full max-w-md object-cover",style:{aspectRatio:"4 / 3",objectPosition:"56% 40%"},"data-testid":"img-history-collaboration"', 1)

# Hero: the promo video (English captions) is replaced by a photo of Will leading a
# packed Yaru session. Framed slightly left of centre to keep him in view.
js = sub_exact(js, 'b1="/assets/yaru-create-promo-vid-ij--uKmM.mov"', 'b1=""', 1)  # video no longer shipped
HERO_IMG = ("/assets/hero-will-leading-session.jpg", "40% 50%", "Will Lin นำเซสชันของ Yaru ในห้องที่เต็มไปด้วยผู้เข้าร่วม")
js, n = re.subn(r'm\.jsx\("video",\{ref:n,.*?m\.jsx\(cx,\{className:"w-5 h-5"\}\)\}\)',
    lambda _m: 'm.jsx("img",{src:%s,alt:%s,className:"w-full h-full object-cover",style:{objectPosition:%s},"data-testid":"img-hero-main"})'
        % (json.dumps(HERO_IMG[0]), json.dumps(HERO_IMG[2], ensure_ascii=False), json.dumps(HERO_IMG[1])), js, count=1, flags=re.S)
if n != 1:
    sys.exit("hero video block not found")

# AI tools strip: Google AI Studio -> Gemini (better known to Thai visitors)
js = sub_exact(js, '["Lovable","Claude","ChatGPT","Replit","Google AI Studio"]', '["Claude","ChatGPT","Gemini","Lovable","Replit"]', 1)

for en, th in NAV.items():
    js = sub_exact(js, f'{{name:"{en}",href:', f'{{name:"{en}",th:{js_lit(th)},href:', 1)
js = sub_exact(js, "children:o.name},o.name)", "children:o.th},o.name)", 1)

for en, th in T_BACKTICK.items():
    js = sub_exact(js, f"`{en}`", js_lit(th), 1)

for en, th in T.items():
    # quoted literal, but never an analytics id or a nav name
    pat = re.compile(r'(?<!content_id:)(?<!name:)"' + re.escape(en) + '"')
    js, n = pat.subn(lambda _m, th=th: js_lit(th), js)
    if n == 0:
        sys.exit(f"string not found: {en!r}")

# ---------------------------------------------------------------------------
# 2. Typography hooks: mark caption / small-print elements as thin.
# ---------------------------------------------------------------------------
THIN = [
    'className:"text-sm text-muted-foreground font-medium",children:"กำลังโหลด',  # loading
    'className:"text-xs text-muted-foreground mb-6 font-semibold tracking-widest uppercase"',  # tools label
    'className:"text-white/40 text-sm mt-2"',                                     # quote attribution
    'className:"text-muted-foreground text-sm",children:"COO',                    # CEO title
    'className:"text-sm text-muted-foreground",children:"ไม่ต้องมีประสบการณ์',          # final CTA footnote
    'className:"text-sm text-muted-foreground",children:"ถ้าไม่เห็น',            # success footnote
    'className:"text-muted-foreground text-center text-sm mb-8"',                 # form subtitle
    'className:"text-xs text-muted-foreground text-center"',                      # form footnote
    'className:"text-sm opacity-60 italic"',                                      # Day 5 quote
]
for hook in THIN:
    if hook not in js:
        sys.exit(f"thin hook not found: {hook}")
    js = js.replace(hook, hook.replace('className:"', 'className:"yt-thin ', 1), 1)
# Day labels on the carousel cards (template literal className)
js = sub_exact(js, "className:`text-xs font-bold tracking-widest uppercase mb-3 ",
               "className:`yt-thin text-xs font-bold tracking-widest uppercase mb-3 ", 1)

# Font readiness check: wait for Sukhumvit instead of PPValve
js = sub_exact(js, 'document.fonts.load("800 1em PPValve"),document.fonts.load("200 1em PPValve")',
               'document.fonts.load("700 1em Sukhumvit"),document.fonts.load("400 1em Sukhumvit"),document.fonts.load("200 1em Sukhumvit")', 1)

# ---------------------------------------------------------------------------
# 3. CSS: Sukhumvit everywhere (Thai + English). Bold titles / Text body / Thin captions.
# ---------------------------------------------------------------------------
css = sub_exact(css, "--font-sans: Open Sans, sans-serif", '--font-sans: "Sukhumvit", sans-serif', 1)
css = sub_exact(css, '--font-headers: "PPValve", sans-serif', '--font-headers: "Sukhumvit", sans-serif', 1)
css = sub_exact(css, "h1,h2{font-family:var(--font-headers)!important;font-weight:800!important;",
                "h1,h2{font-family:var(--font-headers)!important;font-weight:700!important;", 1)
css = sub_exact(css, "h3,h4,h5,h6{font-family:var(--font-headers)!important;font-weight:200!important}",
                "h3,h4,h5,h6{font-family:var(--font-headers)!important;font-weight:700!important}", 1)
css = sub_exact(css, "nav button,nav a{font-family:var(--font-headers)!important;font-weight:200!important}",
                "nav button,nav a{font-family:var(--font-headers)!important;font-weight:400!important}", 1)

FONT_CSS = """@font-face{font-family:"Sukhumvit";src:url(/fonts/SukhumvitSet-Bold.ttf) format("truetype");font-weight:700 900;font-style:normal;font-display:swap}
@font-face{font-family:"Sukhumvit";src:url(/fonts/SukhumvitSet-Text.ttf) format("truetype");font-weight:300 699;font-style:normal;font-display:swap}
@font-face{font-family:"Sukhumvit";src:url(/fonts/SukhumvitSet-Thin.ttf) format("truetype");font-weight:100 299;font-style:normal;font-display:swap}
"""
# Rules: titles bold (h1-h3, font-bold), everything else normal, captions thin.
# Letter-spacing is dropped: tracking breaks Thai glyph clusters.
TH_CSS = """.font-medium,.font-semibold{font-weight:400}
.yt-thin{font-weight:200!important}
.yt-plans{display:grid;gap:10px}
.yt-plan{display:flex;justify-content:space-between;align-items:center;gap:16px;border:1px solid hsl(var(--primary-foreground)/.3);background:hsl(var(--primary-foreground)/.1);border-radius:16px;padding:16px 20px}
.yt-plan-name{font-weight:700;font-size:1.125rem}
.yt-plan-note{font-size:.875rem;opacity:.8;margin-top:2px}
.yt-plan-tag{display:inline-block;margin-top:8px;font-size:.75rem;padding:2px 10px;border-radius:999px;background:hsl(var(--primary-foreground));color:hsl(var(--primary))}
.yt-plan-prices{text-align:right;white-space:nowrap}
.yt-was{display:block;font-size:.9rem;opacity:.7}
.yt-price{font-weight:700;font-size:1.5rem;line-height:1.2}
.yt-unit{font-size:.875rem;font-weight:200}
.yt-pkgs{display:grid;gap:8px;grid-template-columns:1fr}
.yt-pkg{cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;border:2px solid hsl(var(--input));border-radius:12px;padding:12px 14px;transition:border-color .15s,background-color .15s}
.yt-pkg-on{border-color:hsl(var(--primary));background:hsl(var(--primary)/.06)}
.yt-pkg:focus-within{outline:2px solid hsl(var(--ring));outline-offset:2px}
.yt-pkg-name{font-weight:700;font-size:.95rem}
.yt-pkg-desc{font-size:.8rem;color:hsl(var(--muted-foreground))}
.tracking-wide,.tracking-wider,.tracking-widest,.tracking-tight{letter-spacing:0}
"""
css = FONT_CSS + css + TH_CSS

(OUT / "assets/index-th.js").write_text(js)
(OUT / "assets/index-th.css").write_text(css)

# ---------------------------------------------------------------------------
# 4. index.html
# ---------------------------------------------------------------------------
html = (SRC / "index.en.html").read_text()
TITLE = "Yaru Create - ชาเลนจ์ 5 วัน: นำไอเดียของคุณออกมาหารายได้ด้วย AI"
DESC = "ซื้อคอร์สชาเลนจ์ 5 วันกับ Yaru แล้วนำไอเดียของคุณออกมาหารายได้ภายใน 5 วันด้วย AI ไม่ต้องเขียนโค้ด ไม่ต้องมีประสบการณ์ ราคาพิเศษเริ่มต้น ฿3,990"
OG_DESC = "ไม่ต้องเขียนโค้ด ไม่ต้องมีประสบการณ์ ไม่มีข้ออ้าง เลือกไอเดีย ลงมือสร้าง แล้วนำไปให้คนได้เห็นจริง ภายใน 1 สัปดาห์ ราคาพิเศษเริ่มต้น ฿3,990"
html = sub_exact(html, '<html lang="en">', '<html lang="th">', 1)
html = sub_exact(html, "Yaru Create - Free 5-Day Challenge: Launch a Product Idea with AI", TITLE)
html = sub_exact(html, "Join the free Yaru 5-Day Challenge and go from idea to launched product in one week. No code. No experience. Pick your idea, start building, and get it in front of real people. Free.", DESC, 1)
html = sub_exact(html, "No code. No experience. No excuses. Pick your idea, start building, and get it in front of real people. In a week, for free.", OG_DESC, 2)
# Fonts: swap PPValve preloads/@font-face for Sukhumvit
html = re.sub(r'\s*<link rel="preload" href="/fonts/PPValve[^>]*>', "", html)
html = re.sub(r"<!-- Inline critical font styles.*?</style>", lambda m: (
    '<link rel="preload" href="/fonts/SukhumvitSet-Bold.ttf" as="font" type="font/ttf" crossorigin>\n'
    '    <link rel="preload" href="/fonts/SukhumvitSet-Text.ttf" as="font" type="font/ttf" crossorigin>\n'
    '    <link rel="preload" href="/fonts/SukhumvitSet-Thin.ttf" as="font" type="font/ttf" crossorigin>'),
    html, count=1, flags=re.S)
# Tracking: the English site's GTM container (which fires the English TikTok pixel),
# Meta Pixel and ActiveCampaign are all removed so the Thai A/B test starts clean.
# The Thai TikTok pixel gets added here once it exists.
for name in ["Google Tag Manager", "Google Tag Manager (TikTok)", "Meta Pixel Code",
             "Meta Pixel noscript fallback", "Google Tag Manager (noscript)",
             "Google Tag Manager (TikTok noscript)", "ActiveCampaign Site Tracking"]:
    html, n = re.subn(r"\s*<!-- " + re.escape(name) + r" -->.*?<!-- End " + re.escape(name) + r" -->", "", html, flags=re.S)
    if n != 1:
        sys.exit(f"tracking block not found: {name}")
LINE_TAG_BASE = """<!-- LINE Tag Base Code -->
<!-- Do Not Modify -->
<script>
(function(g,d,o){
  g._ltq=g._ltq||[];g._lt=g._lt||function(){g._ltq.push(arguments)};
  var h='https://d.line-scdn.net';
  var s=d.createElement('script');s.async=1;
  s.src=o||h+'/n/line_tag/public/release/v1/lt.js';
  var t=d.getElementsByTagName('script')[0];t.parentNode.insertBefore(s,t);
    })(window, document);
_lt('init', {
  customerType: 'lap',
  tagId: '34e8f29d-a401-4dcc-b551-e49132bbd5d4'
});
_lt('send', 'pv', ['34e8f29d-a401-4dcc-b551-e49132bbd5d4']);
</script>
<noscript>
  <img height="1" width="1" style="display:none"
       src="https://tr.line.me/tag.gif?c_t=lap&t_id=34e8f29d-a401-4dcc-b551-e49132bbd5d4&e=pv&noscript=1" />
</noscript>
<!-- End LINE Tag Base Code -->
"""
# after the charset/viewport tags, so the UTF-8 declaration stays first in <head>
VIEWPORT = '    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />\n'
html = sub_exact(html, VIEWPORT, VIEWPORT + LINE_TAG_BASE, 1)
html = sub_exact(html, "/assets/index-DQqFpzXo.js", "/assets/index-th.js", 1)
html = sub_exact(html, "/assets/index-K9wBeB5c.css", "/assets/index-th.css", 1)
(OUT / "index.html").write_text(html)

left = [s for s in re.findall(r'children:"([^"]*[A-Za-z]{4,}[^"]*)"', js[255000:])]
print("built. remaining English children literals:", left)
