import type { Metadata } from "next";
import { DM_Sans, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Code2,
  GitBranch,
  GitPullRequest,
  MapPin,
  Monitor,
  MousePointer2,
  ScanEye,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { EvidenceDemo } from "@/components/landing/EvidenceDemo";
import { TesterDemo } from "@/components/landing/TesterDemo";
import styles from "@/components/landing/LandingPage.module.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-studio-sans",
  display: "swap",
});
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-studio-serif",
  display: "swap",
});
const repository = "https://github.com/vihuynh72/pinepoint";
const demoPr = `${repository}/pull/10`;

export const metadata: Metadata = {
  title: "PinePoint — Find the break. Open the bug.",
  description:
    "Ten QA agents test your pull request in real browsers. See the evidence, open the broken session, and review a proposed fix. Built for GitHub and Vercel previews.",
};

const questions = [
  {
    question: "Do I need to write a test suite?",
    answer:
      "PinePoint reads the PR diff and your qa.md, then plans ten missions for the preview. Each simulated user explores one goal in its own browser. Your existing tests still have their place; PinePoint adds another look at the running product.",
  },
  {
    question: "How does PinePoint check a finding?",
    answer:
      "Failed preview missions are checked again and compared with production when applicable. Confirmed bugs, possible issues, and existing production bugs get different labels, so you can see what the evidence actually supports.",
  },
  {
    question: "Will it change my code?",
    answer:
      "You make the decision. When you mark a confirmed finding as a bug, PinePoint can propose a fix. You review it and choose whether to post it as a GitHub suggestion. You commit the change yourself.",
  },
  {
    question: "What can I try today?",
    answer:
      "The current MVP tests GitHub pull requests with Vercel previews. Start with the sample dashboard or the demo PR to explore the workflow. A dedicated rerun of a failed mission after a fix is still in development.",
  },
];

export default function Home() {
  return (
    <div className={`${styles.site} ${sans.variable} ${serif.variable}`}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>
      <header className={`${styles.container} ${styles.header}`}>
        <Link href="/" className={styles.wordmark} aria-label="PinePoint home">
          <span className={styles.brandMark}>
            <MapPin size={20} strokeWidth={1.8} aria-hidden />
          </span>
          PinePoint
        </Link>
        <nav className={styles.navigation} aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#your-call">Your call</a>
          <a href={repository}>
            GitHub <ArrowUpRight size={13} aria-hidden />
          </a>
        </nav>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <Link href="/app" className={styles.headerCta}>
            Test a PR <ArrowUpRight size={15} aria-hidden />
          </Link>
        </div>
      </header>
      <main id="main-content">
        <section
          className={`${styles.container} ${styles.hero}`}
          aria-labelledby="hero-title"
        >
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.statusDot} /> QA agents for every pull
              request
            </p>
            <h1 id="hero-title">
              <span>Find the break.</span>
              <em>Open the bug.</em>
            </h1>
            <p className={styles.heroDescription}>
              Ten simulated users test your preview in real browsers. When
              something breaks, step into the session and see it for yourself.
            </p>
            <div className={styles.actions}>
              <Link href="/app" className={styles.primaryButton}>
                Test a PR <ArrowUpRight size={19} aria-hidden />
              </Link>
              <a href="#how-it-works" className={styles.textButton}>
                See it in action <ArrowDown size={16} aria-hidden />
              </a>
            </div>
            <p className={styles.heroNote}>
              <GitPullRequest size={15} aria-hidden /> For the code you ship.
              And the bugs you don’t see.
            </p>
          </div>
          <EvidenceDemo />
        </section>
        <div
          className={`${styles.container} ${styles.integrationStrip}`}
          aria-label="Works with your pull request workflow"
        >
          <p>
            A new perspective.
            <br />
            <strong>Right in your workflow.</strong>
          </p>
          <div className={styles.integrations}>
            <span>
              <GitBranch size={19} aria-hidden /> GitHub PR
            </span>
            <ArrowRight
              size={17}
              aria-hidden
              className={styles.integrationArrow}
            />
            <span>
              <Code2 size={19} aria-hidden /> Vercel preview
            </span>
            <ArrowRight
              size={17}
              aria-hidden
              className={styles.integrationArrow}
            />
            <span>
              <Monitor size={19} aria-hidden /> Pine Computers
            </span>
          </div>
        </div>
        <section
          id="how-it-works"
          className={`${styles.container} ${styles.testersSection}`}
          aria-labelledby="testers-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>01 / Find the break</p>
              <h2 id="testers-title">
                One preview.
                <br />
                <em>Ten fresh perspectives.</em>
              </h2>
            </div>
            <p>
              The first-time buyer. The keyboard user. The person who applies a
              coupon twice. Different missions find different ways to break your
              changes.
            </p>
          </div>
          <TesterDemo />
          <div className={styles.coverageNote}>
            <ScanEye size={17} aria-hidden />
            <p>
              Planned from your diff and <code>qa.md</code>. Tested through
              Flow, UI, Abuse, Access, and Safety lenses.
            </p>
          </div>
        </section>
        <section
          id="your-call"
          className={styles.decisionSection}
          aria-labelledby="decision-title"
        >
          <div className={`${styles.container} ${styles.decisionLayout}`}>
            <div className={styles.decisionCopy}>
              <p className={styles.eyebrow}>02 / Open the bug</p>
              <h2 id="decision-title">
                The moment it broke.
                <br />
                <em>Ready for a closer look.</em>
              </h2>
              <p>
                Open a retained live session from the finding. Inspect the cart,
                the inputs, and the browser that found the problem. Take control
                when you need to.
              </p>
              <a href="/app?fake=1" className={styles.lightButton}>
                Explore the sample dashboard{" "}
                <ArrowUpRight size={17} aria-hidden />
              </a>
              <p className={styles.sampleNote}>
                Sample data · no live run required
              </p>
            </div>
            <div className={styles.reviewCard}>
              <div className={styles.reviewHeader}>
                <GitPullRequest size={17} aria-hidden />
                <span>PinePoint review</span>
                <span className={styles.exampleLabel}>Example</span>
              </div>
              <div className={styles.reviewBody}>
                <div className={styles.reviewAuthor}>
                  <span className={styles.reviewAvatar}>
                    <MapPin size={18} aria-hidden />
                  </span>
                  <span>
                    <strong>PinePoint</strong>
                    <small>Found on the PR preview</small>
                  </span>
                </div>
                <h3>SAVE10 applies twice.</h3>
                <p>
                  Expected <strong>$21.60</strong>. Saw <strong>$19.44</strong>.
                </p>
                <ol>
                  <li>Add a sage linen apron.</li>
                  <li>Apply SAVE10.</li>
                  <li>Apply SAVE10 again.</li>
                </ol>
                <div className={styles.reviewSession}>
                  <MousePointer2 size={15} aria-hidden />
                  <span>Screenshot. Steps. A link to the session.</span>
                </div>
              </div>
              <div className={styles.suggestion}>
                <div>
                  <Code2 size={15} aria-hidden />
                  <span>A proposed fix, for your review</span>
                </div>
                <pre>
                  <code>
                    {
                      'if (cart.coupons.includes(code)) {\n  return { cart, message: "Coupon already applied." };\n}'
                    }
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </section>
        <section
          className={`${styles.container} ${styles.decisions}`}
          aria-label="How you stay in control"
        >
          <div>
            <span className={styles.stepNumber}>01</span>
            <h3>Evidence you can inspect.</h3>
            <p>
              Screenshots and short steps show what happened. Rechecks help
              separate bugs from noise.
            </p>
          </div>
          <div>
            <span className={styles.stepNumber}>02</span>
            <h3>You make the call.</h3>
            <p>
              Mark Bug or Not a bug. PinePoint keeps the decision with the
              finding and on the PR.
            </p>
          </div>
          <div>
            <span className={styles.stepNumber}>03</span>
            <h3>A fix you can review.</h3>
            <p>
              Get a proposed code change. Read it, post the suggestion, and
              commit it when you’re ready.
            </p>
          </div>
        </section>
        <section
          className={`${styles.container} ${styles.faq}`}
          aria-labelledby="faq-title"
        >
          <div>
            <p className={styles.eyebrow}>A few good questions</p>
            <h2 id="faq-title">
              Before your
              <br />
              <em>first run.</em>
            </h2>
          </div>
          <div className={styles.questions}>
            {questions.map(({ question, answer }) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={18} aria-hidden />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section
          className={`${styles.container} ${styles.finalCta}`}
          aria-labelledby="cta-title"
        >
          <span className={styles.ctaMark}>
            <MapPin size={25} strokeWidth={1.6} aria-hidden />
          </span>
          <p className={styles.eyebrow}>Your next PR has company</p>
          <h2 id="cta-title">
            A QA team for
            <br />
            <em>what you ship next.</em>
          </h2>
          <div className={styles.actions}>
            <Link href="/app" className={styles.primaryButton}>
              Test a PR <ArrowUpRight size={19} aria-hidden />
            </Link>
            <a href={demoPr} className={styles.textButton}>
              See the demo PR <ArrowUpRight size={16} aria-hidden />
            </a>
          </div>
          <p className={styles.ctaNote}>
            <Check size={14} aria-hidden /> Real browsers. Clear evidence. Your
            decision.
          </p>
        </section>
      </main>
      <footer className={`${styles.container} ${styles.footer}`}>
        <Link href="/" className={styles.wordmark}>
          <MapPin size={20} aria-hidden /> PinePoint
        </Link>
        <p>Built on Pine Computers. Made for the next commit.</p>
        <a href={repository}>
          Follow the build <ArrowUpRight size={14} aria-hidden />
        </a>
      </footer>
    </div>
  );
}
