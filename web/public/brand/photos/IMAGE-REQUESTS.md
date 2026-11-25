# Brand photos for the public pages

Drop each file here as **WebP** with the exact name below, then restart `pnpm dev`. The folder is read once per server start. Every page already looks finished without the photos; a photo appears only once its file exists.

General rules for every image:
- Realistic photography, Saudi setting (Riyadh), natural daylight or warm indoor light.
- **No readable text, no logos, no brand uniforms, no app screens** (HungerStation's marks are trademarks, and on-screen text is added by the site itself).
- Warm palette that sits well next to deep brown `#471C09` and yellow `#FFD700`. A touch of yellow (a bag, a jacket detail) helps.
- Faces may be visible but not the focus; people look busy and competent, not posed at the camera.
- Export about 80% quality. Keep each file under 400 KB.

| File | Size (px) | Where it shows |
|---|---|---|
| `auth.webp` | 1200 × 1600 (portrait) | Left brand panel of `/signin` and `/signup`, at 35% opacity over deep brown |
| `lesson-frame.webp` | 900 × 1100 | The video area inside the phone mock-up in the landing hero |
| `role-courier.webp` | 1600 × 1000 | "مندوبو التوصيل" card on the landing page |
| `role-employee.webp` | 1600 × 1000 | "موظفو العمليات والدعم" card |
| `role-partner.webp` | 1600 × 1000 | "الشركاء: المطاعم والمقاهي" card |

## Prompts (any image model: Gemini/Imagen, Flux, Midjourney, SDXL)

**auth.webp**
> Vertical photo, a Saudi delivery courier in a plain dark-brown jacket standing outside a modern Riyadh restaurant at golden hour, looking down at his phone with a calm focused expression, a yellow insulated delivery bag on his shoulder, shallow depth of field, warm tones, no text, no logos, photorealistic, 35mm.

**lesson-frame.webp**
> Photo, restaurant pickup counter in Riyadh from the courier's point of view, a staff member's hands placing a sealed paper delivery bag on the counter, a courier's hand holding a phone at the edge of the frame, warm indoor light, clean background, no text, no logos, no readable screens, photorealistic.

**role-courier.webp**
> Wide photo, a Saudi courier on a parked motorbike at the curb, helmet on the seat, checking a phone between orders, yellow delivery box, modern Riyadh street in soft afternoon light, no text, no logos, photorealistic.

**role-employee.webp**
> Wide photo, a Saudi woman in a modern operations office in Riyadh wearing a headset, reviewing a customer case on a laptop (screen not readable, angled away), colleagues softly blurred behind, warm neutral tones, no text, no logos, photorealistic.

**role-partner.webp**
> Wide photo, busy Saudi café/restaurant kitchen pass, a staff member in a dark apron sealing a paper delivery bag with a sticker, hot and cold items in separate bags, a tablet on a stand (screen not readable), warm light, no text, no logos, photorealistic.

## Or use free stock photos

Unsplash and Pexels allow commercial use without attribution. Useful searches: `delivery rider phone`, `restaurant takeaway counter`, `customer support headset office`, `cafe kitchen packing order`, `riyadh street`. Crop to the sizes above, remove any visible logos, and convert to WebP (for example `cwebp -q 80 in.jpg -o auth.webp`).
