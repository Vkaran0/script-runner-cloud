# Script Runner Cloud

Mujhe ek website banani hai jisme mai apne website ka link dal du aur script dal du to vo apne ap us script ko us website k console me run krte rhe, cloud based.

Context: Meri ek script hai jo rate limiting check karti hai (10 rapid POST requests bhejti hai aur dekhti hai kitne 429 blocked aaye). Ye script pure API/fetch based hai, koi DOM access nahi chahiye. Example script:

(async () => {
  const API = "https://navrang-xnwq.onrender.com";
  console.log("=== RATE LIMITING TEST (10 rapid requests) ===\n");
  let blocked = 0, allowed = 0;
  for (let i = 1; i <= 10; i++) {
    try {
      const res = await fetch(API + "/api/verify-pass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passId: `FAKE-${i}`, gate: "Test" })
      });
      if (res.status === 429) { blocked++; console.log(`Request ${i}: BLOCKED (429)`); }
      else { allowed++; console.log(`Request ${i}: ${res.status}`); }
    } catch (e) { console.log(`Request ${i}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`Result: ${allowed} allowed, ${blocked} blocked`);
})();

Features chahiye:
- Ek dashboard jahan mai multiple "jobs" add kar sakun: har job me ek website/API ka link aur ek JavaScript script paste karne ho.
- Har job ke liye schedule set ho (default har 10 minute, but configurable).
- Ye cloud based ho — script bina mere browser/laptop khole server par automatically chalti rahe.
- Har run ka log dikhe (script ke console.log output, success/fail, timestamp).
- Jobs ko pause/resume/delete karne ka option.
- Live logs console jaisi feel me dikhein.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1df5d258-e109-47f5-bdbb-e7f5113b3f6d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
