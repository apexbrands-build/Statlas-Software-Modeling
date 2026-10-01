import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authEnabled, SESSION_COOKIE_OPTIONS, supabaseKey, supabaseUrl } from "@/lib/supabase/env";

/** Keeps the Supabase session fresh and sends signed-out visitors to /login. */
export async function proxy(request: NextRequest) {
  if (!authEnabled) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = path === "/login" || path.startsWith("/auth/") || path === "/api/jobs/run" || path === "/api/jobs/tick"; // the two job routes check their own signature / secret
  if (!data.user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const shop = request.nextUrl.searchParams.get("shop");
  if (data.user && path === "/" && shop && request.nextUrl.searchParams.get("hmac")) {
    const url = request.nextUrl.clone();
    url.pathname = "/settings";
    url.search = `?shop=${encodeURIComponent(shop)}`;
    return NextResponse.redirect(url);
  }
  if (data.user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
