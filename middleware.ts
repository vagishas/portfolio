/**
 * Password lock + "site in progress" switch.
 *
 * 1. Case studies: every page in /work/ needs the password (as before).
 * 2. Site in progress: while the Vercel Environment Variable
 *    SITE_IN_PROGRESS is set to "on", every page shows in-progress.html
 *    instead, unless the visitor has unlocked with the password. That lets
 *    you keep previewing the real site while everyone else sees the notice.
 *    Delete the variable (or set it to "off") and redeploy to go live again.
 *
 * The password lives in the Vercel Environment Variable CASE_STUDY_PASSWORD,
 * never in this file, so it isn't visible on GitHub.
 */

export const config = {
  // Every page, but not images, fonts, styles or scripts
  matcher: ['/((?!images/|.*\\.(?:png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|otf)$).*)'],
};

const COOKIE = 'cs_access';
const THIRTY_DAYS = 60 * 60 * 24 * 30;
const ALWAYS_OPEN = ['/in-progress.html', '/unlock.html'];

// The cookie stores a fingerprint of the password, not the password itself.
// Changing the password in Vercel automatically logs everyone out.
async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`case-studies:v1:${password}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

// Only send people back to a page on this site
function safeNext(value: string | null): string {
  if (value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value;
  return '/index.html';
}

function redirect(location: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...extraHeaders } });
}

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const password = process.env.CASE_STUDY_PASSWORD;
  const inProgress = (process.env.SITE_IN_PROGRESS || '').trim().toLowerCase() === 'on';

  if (ALWAYS_OPEN.includes(path)) return;

  const isWork = path.startsWith('/work/');
  const isUnlockPost = path === '/unlock';

  // Nothing to protect on this page right now
  if (!isWork && !isUnlockPost && !inProgress) return;

  // Fail closed: if no password is set in Vercel, locked pages aren't shown.
  if (!password) {
    if (inProgress && !isWork && !isUnlockPost) {
      return new Response(null, { status: 302, headers: { Location: '/in-progress.html', 'Cache-Control': 'no-store' } });
    }
    return redirect(`/unlock.html?error=setup&next=${encodeURIComponent(path)}`);
  }

  // The password form posts here
  if (isUnlockPost) {
    if (request.method !== 'POST') return redirect('/unlock.html');
    const form = await request.formData();
    const attempt = String(form.get('password') || '');
    const next = safeNext(String(form.get('next') || ''));
    const [given, expected] = await Promise.all([tokenFor(attempt), tokenFor(password)]);
    if (given !== expected) {
      return redirect(`/unlock.html?error=wrong&next=${encodeURIComponent(next)}`);
    }
    return redirect(next, {
      'Set-Cookie': `${COOKIE}=${expected}; Path=/; Max-Age=${THIRTY_DAYS}; HttpOnly; Secure; SameSite=Lax`,
    });
  }

  // Unlocked visitors see everything
  if (readCookie(request, COOKIE) === (await tokenFor(password))) return;

  // Everyone else: the in-progress notice, or the password page for case studies
  if (inProgress) {
    return new Response(null, { status: 302, headers: { Location: '/in-progress.html', 'Cache-Control': 'no-store' } });
  }
  return redirect(`/unlock.html?next=${encodeURIComponent(path)}`);
}
