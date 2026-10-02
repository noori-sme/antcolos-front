import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const token = request.cookies.get('antcolos_token')?.value

  if (request.nextUrl.pathname === '/') {
    if (token) {
      return NextResponse.redirect(new URL('/home', request.url))
    } else {
      return NextResponse.redirect(new URL('/sign-in', request.url))
    }
  }
}

export const config = {
  matcher: ['/'],
}
