"use client";

import React, { useMemo, useState } from "react";
import { motion, PanInfo } from "framer-motion";
import styles from "./PlotSelector.module.css";

export interface PlotChoice {
  id: string;
  label: string;
  contextHint?: string;
}

interface PlotSelectorProps {
  choices: PlotChoice[];
  onSelect?: (choice: PlotChoice) => void;
}

const SWIPE_THRESHOLD_PX = 70;

export default function PlotSelector({ choices, onSelect }: PlotSelectorProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const activeChoice = useMemo(
    () => (choices.length > 0 ? choices[activeIndex] : null),
    [choices, activeIndex]
  );

  function setChoice(nextIndex: number): void {
    if (choices.length === 0) return;
    const boundedIndex = Math.max(0, Math.min(choices.length - 1, nextIndex));
    setActiveIndex(boundedIndex);
    onSelect?.(choices[boundedIndex]);
  }

  function handleDragEnd(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo): void {
    if (info.offset.x <= -SWIPE_THRESHOLD_PX) {
      setChoice(activeIndex + 1);
      return;
    }
    if (info.offset.x >= SWIPE_THRESHOLD_PX) {
      setChoice(activeIndex - 1);
    }
  }

  if (choices.length === 0) {
    return null;
  }

  return (
    <section className={styles.container} aria-label="Interactive plot selector">
      <p className={styles.title}>Swipe to steer the story</p>
      <motion.div
        key={activeChoice?.id}
        className={styles.card}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        onDragEnd={handleDragEnd}
        whileTap={{ scale: 0.98 }}
        initial={{ opacity: 0.6, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <p className={styles.choiceLabel}>{activeChoice?.label}</p>
        {activeChoice?.contextHint && <p className={styles.choiceHint}>{activeChoice.contextHint}</p>}
      </motion.div>
      <div className={styles.dots} aria-hidden="true">
        {choices.map((choice, idx) => (
          <button
            key={choice.id}
            type="button"
            className={`${styles.dot} ${idx === activeIndex ? styles.active : ""}`}
            onClick={() => setChoice(idx)}
            aria-label={`Select plot option ${idx + 1}`}
          />
        ))}
      </div>
    </section>
  );
}
