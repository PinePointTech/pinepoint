"use client";

import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  CircleAlert,
  GitPullRequest,
  MousePointer2,
  X,
} from "lucide-react";
import styles from "./EvidenceDemo.module.css";

export function EvidenceDemo() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div className={styles.scene}>
      <div className={styles.pullRequest}>
        <GitPullRequest size={15} aria-hidden />
        <span>PR #10 · Add free shipping</span>
        <span className={styles.demoLabel}>Demo</span>
      </div>
      <div className={styles.browser}>
        <div className={styles.browserBar}>
          <span className={styles.windowDots} aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>preview / cart</span>
          <span className={styles.liveLabel}>
            <span /> Finding captured
          </span>
        </div>
        <div className={styles.screenshot}>
          <Image
            src="/demo/coupon-bug.png"
            width={1280}
            height={800}
            alt="Demo store cart showing SAVE10 applied twice and an incorrect total of $19.44."
            sizes="(max-width: 760px) 92vw, 48vw"
            loading="eager"
          />
          <div className={styles.annotation}>
            <CircleAlert size={14} aria-hidden /> Same coupon. Second discount.
          </div>
        </div>
        <div className={styles.finding}>
          <div className={styles.findingTitle}>
            <span className={styles.alertIcon}>
              <CircleAlert size={18} aria-hidden />
            </span>
            <div>
              <h2>One coupon. Two discounts.</h2>
              <p>Found by the coupon tester</p>
            </div>
          </div>
          <div className={styles.comparison}>
            <div>
              <span>Expected</span>
              <strong>$21.60</strong>
            </div>
            <span className={styles.comparisonDivider} aria-hidden />
            <div>
              <span>Preview</span>
              <strong className={styles.bugValue}>$19.44</strong>
            </div>
          </div>
          <button
            type="button"
            className={styles.openButton}
            onClick={() => dialog.current?.showModal()}
          >
            <span>Open the bug</span>
            <MousePointer2 size={17} aria-hidden />
          </button>
          <p className={styles.caption}>
            Interactive example · recorded demo screenshot
          </p>
        </div>
      </div>
      <div className={styles.evidenceTag}>
        <span /> The context comes with the finding.
      </div>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby="example-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className={styles.dialogHeader}>
          <div>
            <p>Example finding / PR #10</p>
            <h2 id="example-title">The coupon applies twice.</h2>
          </div>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Close example finding"
          >
            <X size={21} aria-hidden />
          </button>
        </div>
        <Image
          src="/demo/coupon-bug.png"
          width={1280}
          height={800}
          alt="Recorded browser screenshot: SAVE10 is applied twice. The cart total is $19.44 instead of $21.60."
          sizes="(max-width: 1000px) 94vw, 920px"
        />
        <div className={styles.dialogDetails}>
          <div>
            <h3>Follow the evidence.</h3>
            <ol>
              <li>Add a sage linen apron.</li>
              <li>Apply SAVE10.</li>
              <li>Apply SAVE10 again.</li>
            </ol>
          </div>
          <div>
            <p>
              This is a recorded example. In a live run, a retained session lets
              you inspect the browser and take control.
            </p>
            <Link href="/app?fake=1">
              Explore the sample dashboard{" "}
              <ArrowUpRight size={16} aria-hidden />
            </Link>
          </div>
        </div>
      </dialog>
    </div>
  );
}
