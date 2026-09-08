---
"@gang-of-beads/pi-web": patch
---

Every font size in the client comes from the type scale. Ninety-seven
declarations named their size in pixels, including steps the scale does not
have — a 10px eyebrow no token move could follow, an 18px glyph beside a 17px
one, a 22px close control next to a 20px one. A contract test fails the suite
on the next pixel font size.
