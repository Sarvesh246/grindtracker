import type { ReactNode } from 'react'
import Link from 'next/link'
import LandingHeader from './LandingHeader'
import HeroDemo from './HeroDemo'
import HeroScrollCue from './HeroScrollCue'
import {
  RestTimerDemo,
  StreakXpDemo,
  ProgressMock,
  LevelUpMock,
  FriendsMock,
  CoachMock,
} from './FeatureDemos'
import InstallSection, { FinalCta, LandingFooter } from './InstallSection'
import MobileInstallPill from './MobileInstallPill'
import HowItWorksDemo from './HowItWorksDemo'
import LandingRise from './LandingRise'
import GoogleSignInButton from '@/components/GoogleSignInButton'

function Section({
  id,
  eyebrow,
  title,
  lead,
  demo,
  reverse,
}: {
  id: string
  eyebrow: string
  title: string
  lead: string
  demo: ReactNode
  reverse?: boolean
}) {
  return (
    <section className="landing-section" id={id}>
      <div
        className={`landing-section__inner landing-section__inner--split${
          reverse ? ' landing-section__inner--reverse' : ''
        }`}
      >
        <LandingRise className="landing-section__copy">
          <p className="landing-eyebrow">{eyebrow}</p>
          <h2 className="landing-h2">{title}</h2>
          <p className="landing-lead">{lead}</p>
        </LandingRise>
        <div className="landing-section__demo">{demo}</div>
      </div>
    </section>
  )
}

export default function LandingPage() {
  return (
    <div className="landing">
      {/* Anchor must not be the scrollport or a sticky child — both make #top a no-op when scrolled. */}
      <span id="top" className="landing-top-anchor" aria-hidden="true" />
      <div className="landing-atmosphere" aria-hidden="true" />
      <LandingHeader />

      <main>
        {/* Hero — brand first, one composition, phone demo as visual anchor */}
        <section className="landing-hero">
          <div className="landing-hero__layout">
            <div className="landing-hero__copy">
              <h1 className="landing-hero__brand">GRIND</h1>
              <p className="landing-hero__tagline">Track. Progress. Dominate.</p>
              <p className="landing-hero__support">
                Log sets in seconds, keep rest-day-aware streaks, and turn every session into XP — free to start.
              </p>
              <div className="landing-hero__ctas">
                <GoogleSignInButton
                  variant="primary"
                  label="Get started"
                  className="landing-btn-primary"
                />
                <Link href="/login" className="landing-btn-secondary press" data-haptic="light">
                  Log in
                </Link>
              </div>
              <p className="landing-hero__auth-hint">Continue with Google · no App Store required</p>
            </div>
            <div className="landing-hero__demo">
              <HeroDemo />
            </div>
          </div>
          <HeroScrollCue targetId="how" />
        </section>

        <Section
          id="how"
          eyebrow="How it works"
          title="Ten seconds from home to a logged PR"
          lead="Open the app, tap today’s day, check the set. Last weight is waiting, the rest timer runs, and a PR badge lands when you earn it — that’s the whole loop."
          demo={<HowItWorksDemo />}
        />

        <Section
          id="log-fast"
          eyebrow="Log fast"
          title="In the gym, every second counts"
          lead="Prefill last weight, rest timer, plate calculator, warm-ups, and an offline set queue — so you stay in the rack, not in the keyboard."
          demo={<RestTimerDemo />}
        />

        <Section
          id="consistent"
          eyebrow="Stay consistent"
          title="Streaks that respect rest days"
          lead="Miss a planned rest day? Fine. Miss a training day? The streak knows. Reminders nudge you back without the guilt trip."
          demo={<StreakXpDemo />}
          reverse
        />

        <Section
          id="progress"
          eyebrow="See progress"
          title="Charts that answer “am I stronger?”"
          lead="e1RM trends, body weight, and photo compare — progress you can feel and prove, without drowning in dashboards."
          demo={<ProgressMock />}
        />

        <Section
          id="coach"
          eyebrow="AI Coach"
          title="Ask what to do next"
          lead="A personal coach that already knows your PRs, streak, and program — quick takes after a session, or a plan when you’re stuck."
          demo={<CoachMock />}
          reverse
        />

        <Section
          id="level-up"
          eyebrow="Level up"
          title="XP, badges, finish moments"
          lead="Every completed session banks XP. PRs hit harder. Badges unlock when the work is real — not when you tap a checkbox."
          demo={<LevelUpMock />}
        />

        <Section
          id="friends"
          eyebrow="Friends"
          title="A private scoreboard"
          lead="Invite friends, rank by day type, and share a dark-branded card when you want the flex — without turning training into a public feed."
          demo={<FriendsMock />}
        />

        <InstallSection />
        <FinalCta />
      </main>

      <LandingFooter />
      <MobileInstallPill />
    </div>
  )
}
