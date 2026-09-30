/**
 * Password lock for case studies.
 *
 * Runs on Vercel before any page in /work/ is served. Visitors without the
 * unlock cookie are sent to /unlock.html. The password itself lives in the
 * Vercel project settings (Environment Variable: CASE_STUDY_PASSWORD), never
 * in this file, so it isn't visible on GitHub.
 *
 * Home, About and Resume are not matched here, so they stay public.
 */

export const config = {
  matcher: ['/work/:path*', '/unlock'],
};

const COOKIE = 'cs_access';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

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

// Only allow sending people back to a page inside /work/
function safeNext(value: string | null): string {
  if (value && value.startsWith('/work/') && !value.startsWith('//')) return value;
  return '/index.html';
}

function redirect(location: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...extraHeaders } });
}

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const password = process.env.CASE_STUDY_PASSWORD;

  // Fail closed: if no password is set in Vercel, nothing in /work/ is shown.
  if (!password) {
    if (url.pathname === '/unlock') return redirect('/unlock.html?error=setup');
    return redirect(`/unlock.html?error=setup&next=${encodeURIComponent(url.pathname)}`);
  }

  // The password form posts here
  if (url.pathname === '/unlock') {
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

  // Any page in /work/: let it through only with a valid cookie
  if (readCookie(request, COOKIE) === (await tokenFor(password))) {
    return; // continue to the page as normal
  }
  return redirect(`/unlock.html?next=${encodeURIComponent(url.pathname)}`);
}
