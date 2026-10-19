"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  Bug,
  Check,
  GitPullRequest,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
} from "lucide-react";
import styles from "./TesterDemo.module.css";

const missions = [
  "Keyboard shopper",
  "Cart explorer",
  "First-time buyer",
  "Shipping check",
  "Coupon repeater",
  "Empty cart",
  "Order flow",
  "Mobile shopper",
  "Coupon stacking",
  "Returning shopper",
];

const BUG_MISSION = 4;
const LAST_STAGE = 3;
const stageDelays = [1100, 1800, 2400];
export function TesterDemo() {
  const container = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [showFinding, setShowFinding] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyPreference = () => {
      setReducedMotion(preference.matches);
      if (preference.matches) {
        setStage(LAST_STAGE);
        setPlaying(false);
      }
    };
    applyPreference();
    preference.addEventListener("change", applyPreference);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!preference.matches) setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    if (container.current) observer.observe(container.current);

    return () => {
      preference.removeEventListener("change", applyPreference);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!playing || reducedMotion || stage === LAST_STAGE) return;
    const timer = window.setTimeout(() => {
      const next = stage + 1;
      setStage(next);
      if (next === LAST_STAGE) {
        setPlaying(false);
      }
    }, stageDelays[stage]);
    return () => window.clearTimeout(timer);
  }, [playing, reducedMotion, stage]);

  function togglePlayback() {
    if (stage === LAST_STAGE) {
      setStage(0);
      setShowFinding(false);
      setPlaying(true);
      return;
    }
    setPlaying((current) => !current);
  }

  function inspectFinding() {
    setStage(LAST_STAGE);
    setPlaying(false);
    setShowFinding((current) => !current);
  }

  const complete = stage === LAST_STAGE;
  const PlaybackIcon = complete ? RotateCcw : playing ? Pause : Play;

  return (
    <div
      ref={container}
      className={styles.demo}
      data-playing={playing}
      aria-label="Illustrative parallel testing demo"
    >
      <div className={styles.toolbar}>
        <div className={styles.previewLabel}>
          <span className={styles.previewIcon}>
            <GitPullRequest size={17} aria-hidden="true" />
          </span>
          <div>
            <span className={styles.previewTitle}>
              One preview. Ten perspectives.
            </span>
            <span className={styles.previewSubtitle}>
              Linen &amp; Oat · demo store
            </span>
          </div>
        </div>
        <div className={styles.toolbarActions}>
          <span className={styles.demoLabel}>Illustrative demo</span>
          {!reducedMotion && (
            <button
              className={styles.playback}
              onClick={togglePlayback}
              type="button"
            >
              <PlaybackIcon size={13} aria-hidden="true" />
              {complete ? "Replay" : playing ? "Pause" : "Play"}
            </button>
          )}
        </div>
      </div>

      <div className={styles.route} aria-hidden="true">
        <span data-active={stage === 0}>
          <GitPullRequest size={13} /> Preview ready
        </span>
        <ArrowRight size={14} className={styles.routeArrow} />
        <span data-active={stage === 1 || stage === 2}>
          <ScanLine size={13} /> Test in parallel
        </span>
        <ArrowRight size={14} className={styles.routeArrow} />
        <span data-active={complete}>
          <Bug size={13} /> Inspect the finding
        </span>
      </div>

      <div className={styles.missions}>
        {missions.map((mission, index) => {
          const isBug = index === BUG_MISSION;
          const testing = stage === 2 || (stage === 1 && index < 5);
          const status = complete
            ? isBug
              ? "Bug found"
              : "Pass"
            : testing
              ? "Testing"
              : "Queued";
          const statusStyle = complete
            ? isBug
              ? styles.bug
              : styles.passed
            : testing
              ? styles.testing
              : styles.queued;
          const contents = (
            <>
              <span className={styles.browserBar} aria-hidden="true">
                <span className={styles.browserDots}>
                  <i />
                  <i />
                  <i />
                </span>
                <span className={styles.browserAddress}>
                  preview / {String(index + 1).padStart(2, "0")}
                </span>
                {complete && isBug ? (
                  <Bug size={11} />
                ) : (
                  <span className={styles.browserDot} />
                )}
              </span>
              <span className={styles.browserViewport} aria-hidden="true">
                <span
                  className={`${styles.storeScreenshot} ${complete && isBug ? styles.bugScreenshot : ""}`}
                />
                {testing && <span className={styles.scan} />}
                <MousePointer2
                  className={styles.cursor}
                  data-active={testing}
                  size={16}
                  style={
                    {
                      "--cursor-x": `${24 + ((index * 13) % 53)}%`,
                      "--cursor-y": `${35 + ((index * 17) % 38)}%`,
                      "--cursor-delay": `${index * -0.25}s`,
                    } as CSSProperties
                  }
                />
                {complete && isBug && (
                  <span className={styles.bugMarker}>
                    <Bug size={13} />
                  </span>
                )}
              </span>
              <span className={styles.missionInfo}>
                <span className={styles.missionName}>{mission}</span>
                <span className={`${styles.status} ${statusStyle}`}>
                  {complete && !isBug ? (
                    <Check size={11} aria-hidden="true" />
                  ) : complete && isBug ? (
                    <Bug size={11} aria-hidden="true" />
                  ) : (
                    <span className={styles.statusDot} aria-hidden="true" />
                  )}
                  {status}
                  {isBug && complete && (
                    <ArrowDownRight size={12} aria-hidden="true" />
                  )}
                </span>
              </span>
            </>
          );
          return isBug ? (
            <button
              key={mission}
              className={`${styles.mission} ${complete ? styles.bugMission : ""}`}
              type="button"
              onClick={inspectFinding}
              aria-expanded={showFinding}
              aria-controls="tester-demo-finding"
              aria-label={`${mission}: ${status}. ${showFinding ? "Hide" : "Inspect"} finding`}
            >
              {contents}
            </button>
          ) : (
            <div className={styles.mission} key={mission}>
              {contents}
            </div>
          );
        })}
      </div>

      <div className={styles.demoFooter}>
        <p className={styles.runStatus}>
          <span
            className={`${styles.runDot} ${complete ? styles.runDone : ""}`}
            aria-hidden="true"
          />
          {complete
            ? "A finding worth a closer look."
            : stage === 0
              ? "Start with the changes in your PR."
              : "Different paths. The same preview."}
        </p>
        <span className={styles.srOnly} role="status">
          {complete
            ? "Illustrative run complete. A repeated coupon finding is ready to inspect."
            : ""}
        </span>
        <button
          type="button"
          className={styles.inspectButton}
          onClick={inspectFinding}
          aria-expanded={showFinding}
          aria-controls="tester-demo-finding"
        >
          {showFinding ? "Hide finding" : "Inspect finding"}
          <ArrowDownRight size={14} aria-hidden="true" />
        </button>
      </div>

      <div
        id="tester-demo-finding"
        className={styles.finding}
        hidden={!showFinding}
      >
        <div className={styles.findingIntro}>
          <span className={styles.findingIcon}>
            <Bug size={18} aria-hidden="true" />
          </span>
          <div>
            <p className={styles.findingEyebrow}>Coupon repeater / finding</p>
            <h3>Same coupon. A second discount.</h3>
            <p>
              Apply SAVE10 twice. The discount stacks when it should only apply
              once.
            </p>
          </div>
        </div>
        <div className={styles.comparison}>
          <div>
            <span>Expected total</span>
            <strong>$21.60</strong>
          </div>
          <ArrowRight size={16} aria-hidden="true" />
          <div className={styles.observed}>
            <span>Observed total</span>
            <strong>$19.44</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
