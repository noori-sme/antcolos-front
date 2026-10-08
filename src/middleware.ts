import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const token = request.cookies.get('antcolos_token')?.value
  const nextStep = request.cookies.get('antcolos_next_step')?.value
  const pathname = request.nextUrl.pathname
  const isAuthPage = 
    pathname === '/sign-in' || 
    pathname === '/sign-up' || 
    pathname.startsWith('/verify-email') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/invite') ||
    pathname.startsWith('/invitation') ||
    pathname.startsWith('/referral');

  // 1. If no token, they must be unauthenticated.
  if (!token) {
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
    if (nextStep === "choose-username" && pathname !== "/sign-up") {
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
    const isAllowedRoute = pathname.startsWith('/onboarding') || pathname.startsWith('/sign-up') || pathname.startsWith('/sign-in') || pathname.startsWith('/verify-email');
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

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
