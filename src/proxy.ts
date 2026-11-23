import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { accessTokenFrom, backendTarget, isAllowedOrigin, upstreamHeaders } from '@/lib/api/bff'
import { SIGNED_IN_AS_DEMO } from '@/lib/api/mode'
import { isAuthPath, isPublicPath } from '@/lib/session/route-access'

export function proxy(request: NextRequest) {
  // Every API call goes through this origin (plan 27): the session token lives
  // in an httpOnly cookie that page scripts cannot read, and is added here.
  if (request.nextUrl.pathname.startsWith(BACKEND_PREFIX)) {
    return toBackend(request)
  }

  const token = request.cookies.get('antcolos_token')?.value
  const nextStep = request.cookies.get('antcolos_next_step')?.value
  const pathname = request.nextUrl.pathname
  const isAuthPage = isAuthPath(pathname)

  // Share, profile, and tracking pages (and their OG images) are for anyone,
  // signed in, mid-onboarding, or not. Never redirect them.
  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  // 1. If no token, they must be unauthenticated.
  if (!token) {
    // Explicit mock mode is signed in as the fixtures' demo user (no backend).
    if (SIGNED_IN_AS_DEMO) {
      return NextResponse.next();
    }
    if (!isAuthPage) {
      // Redirect to sign-in, and clear any stale nextStep cookie
      const response = NextResponse.redirect(new URL('/sign-in', request.url));
      if (nextStep) {
        response.cookies.delete('antcolos_next_step');
      }
      return response;
    }
    // If they are on an auth page with no token, let them stay.
    return NextResponse.next();
  }

  // 2. We HAVE a token. Handle onboarding steps.
  if (nextStep) {
    // The carrier verification link arrives mid-onboarding (nextStep is
    // "verify-carrier"). Redirecting it would drop its ?token=.
    if (pathname === '/verify-carrier') {
      return NextResponse.next()
    }
    // Sign-in and sign-up are always reachable, so an onboarding session can
    // never trap the person (e.g. the carrier link was opened on another
    // device, which finished onboarding there). The screens drop the stale
    // session on mount; it isn't cleared here, because prefetches of a
    // /sign-in link would run this too.
    if (pathname === '/sign-in' || pathname === '/sign-up') {
      return NextResponse.next()
    }
    if (nextStep === "choose-username") {
      return NextResponse.redirect(new URL('/sign-up', request.url))
    }
    if (nextStep === "select-role") {
      const currentStep = request.nextUrl.searchParams.get("step");
      if (pathname !== "/onboarding" || (currentStep !== "role" && currentStep !== "dispatch-fork")) {
        return NextResponse.redirect(new URL('/onboarding?step=role', request.url))
      }
    }
    if (nextStep === "carrier-onboarding") {
      if (pathname !== "/onboarding" || request.nextUrl.searchParams.get("step") !== "carrier") {
        return NextResponse.redirect(new URL('/onboarding?step=carrier', request.url))
      }
    }
    if (nextStep === "verify-carrier") {
      if (pathname !== "/onboarding" || request.nextUrl.searchParams.get("step") !== "verify-carrier") {
        return NextResponse.redirect(new URL('/onboarding?step=verify-carrier', request.url))
      }
    }
    if (nextStep === "company-details") {
      if (pathname !== "/onboarding" || request.nextUrl.searchParams.get("step") !== "create-org") {
        return NextResponse.redirect(new URL('/onboarding?step=create-org', request.url))
      }
    }
    
    // Prevent access to any protected routes (like /home) if there is an active nextStep.
    const isAllowedRoute = pathname.startsWith('/onboarding') || pathname.startsWith('/verify-email');
    if (!isAllowedRoute) {
      return NextResponse.redirect(new URL('/onboarding', request.url))
    }
    
    return NextResponse.next();
  }

  // 3. We HAVE a token and NO nextStep.
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/home', request.url))
  }

  const isStrictAuthPage = pathname === '/sign-in' || pathname === '/sign-up' || pathname.startsWith('/forgot-password');
  
  if (isStrictAuthPage || pathname.startsWith('/onboarding')) {
    return NextResponse.redirect(new URL('/home', request.url))
  }

  return NextResponse.next();
}

const BACKEND_PREFIX = '/api/backend'

/** `/api/backend/<path>` → `<API>/<path>`, authorized by the httpOnly cookie. */
function toBackend(request: NextRequest) {
  // The session cookie is ambient: a write must come from this app's pages.
  if (!isAllowedOrigin(request.method, request.headers, request.nextUrl.origin)) {
    return NextResponse.json({ message: 'Cross-site request refused' }, { status: 403 })
  }
  const target = backendTarget(request.nextUrl.pathname, request.nextUrl.search, BACKEND_PREFIX)
  return NextResponse.rewrite(target, {
    request: { headers: upstreamHeaders(request.headers, accessTokenFrom(request.cookies)) },
  })
}

export const config = {
  matcher: [
    '/api/backend/:path*',
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
