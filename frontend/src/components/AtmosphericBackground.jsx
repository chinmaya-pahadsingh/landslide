import React from 'react';
import './AtmosphericBackground.css';

export default function AtmosphericBackground() {
  return (
    <div className="atmospheric-bg-container" aria-hidden="true">
      {/* Sky and ambient lighting glows */}
      <div className="sky-gradient" />
      <div className="ambient-glow storm-glow" />
      <div className="ambient-glow valley-mist-glow" />
      <div className="ambient-glow cyan-accent-glow" />

      {/* Layered Mountain Landscape SVG */}
      <svg 
        className="mountain-vector-layer" 
        viewBox="0 0 1440 900" 
        preserveAspectRatio="xMidYMax slice"
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Distant Mountain Peak Gradient */}
          <linearGradient id="distMtnGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--dist-mtn-top, #1b3540)" stopOpacity="0.45" />
            <stop offset="70%" stopColor="var(--dist-mtn-bot, #0e1d24)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="var(--dist-mtn-base, #071015)" stopOpacity="0.95" />
          </linearGradient>

          {/* Mid Ridge Mountain Gradient */}
          <linearGradient id="midMtnGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--mid-mtn-top, #13272f)" stopOpacity="0.7" />
            <stop offset="60%" stopColor="var(--mid-mtn-bot, #0a161b)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--mid-mtn-base, #050d11)" stopOpacity="1" />
          </linearGradient>

          {/* Near Forest Treeline Gradient */}
          <linearGradient id="forestGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--forest-top, #0a181c)" />
            <stop offset="50%" stopColor="var(--forest-mid, #061114)" />
            <stop offset="100%" stopColor="var(--forest-base, #03080a)" />
          </linearGradient>

          {/* Mist haze mask */}
          <linearGradient id="mistGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#4a8b99" stopOpacity="0" />
            <stop offset="50%" stopColor="#4a8b99" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#4a8b99" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 1. Distant sharp Himalayan peaks */}
        <path
          d="M0 430 L110 320 L230 380 L340 260 L440 330 L560 210 L670 290 L790 190 L900 280 L1020 220 L1150 310 L1260 200 L1370 290 L1440 240 L1440 900 L0 900 Z"
          fill="url(#distMtnGrad)"
        />

        {/* 2. Mid-range rugged ridges */}
        <path
          d="M0 520 L90 470 L200 420 L310 490 L420 380 L520 440 L650 340 L760 410 L880 320 L1000 420 L1110 360 L1220 430 L1340 350 L1440 410 L1440 900 L0 900 Z"
          fill="url(#midMtnGrad)"
        />

        {/* 3. Valley Mist Layer */}
        <rect x="0" y="380" width="1440" height="220" fill="url(#mistGrad)" />

        {/* 4. Coniferous Pine Forest Silhouette (Northeast India Himalayan Foothills) */}
        <path
          d="M0 640 
             L20 625 L25 635 L40 615 L45 628 L60 600 L65 620 L80 610 L95 590 L105 615 L125 580 L135 605 L155 570 L165 595 L190 560 L205 585 L230 550 L245 578 L275 540 L290 570 L320 535 L335 565 L370 525 L385 555 L420 540 L440 565 L480 530 L500 560 L540 545 L565 575 L610 535 L635 565 L680 520 L705 550 L750 510 L775 545 L820 530 L845 560 L890 515 L915 545 L960 525 L985 555 L1030 510 L1055 545 L1100 530 L1125 560 L1170 520 L1195 550 L1240 535 L1265 568 L1310 525 L1335 555 L1380 540 L1405 570 L1440 550
             L1440 900 L0 900 Z"
          fill="url(#forestGrad)"
        />

        {/* 5. Deep Foreground Edge Forest Canopy */}
        <path
          d="M0 720 
             L30 690 L40 705 L70 670 L85 695 L120 660 L140 685 L180 650 L200 675 L250 640 L270 665 L320 650 L350 680 L400 660 L430 690 L490 670 L520 700 L580 685 L610 715 L680 695 L720 730 L790 705 L830 735 L900 710 L940 740 L1010 700 L1045 730 L1110 690 L1145 720 L1210 675 L1240 705 L1290 660 L1320 690 L1370 650 L1400 680 L1440 660
             L1440 900 L0 900 Z"
          fill="url(#forestGrad)"
          opacity="0.9"
        />
      </svg>
    </div>
  );
}
