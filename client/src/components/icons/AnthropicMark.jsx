// AnthropicMark — the orange starburst Anthropic badge used in the app header
// next to the active Claude model. Extracted from AppHeader.jsx so other
// surfaces (e.g. the Knowledge Base agent sidebar chip) reuse the exact same
// asset instead of a near-miss icon. Defaults preserve the original header
// usage (15px, header logo class), so existing call sites stay `<AnthropicMark />`.
//
// Note: the gradient ids are fixed; rendering the mark more than once on a page
// produces duplicate ids, which is fine here because every instance defines
// identical gradients (the first definition wins and paints them all the same).
export default function AnthropicMark({
  size = 15,
  className = 'app-header-provider-status-logo is-anthropic',
}) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="geometricPrecision"
      textRendering="geometricPrecision"
      imageRendering="optimizeQuality"
      fillRule="evenodd"
      clipRule="evenodd"
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 512 509.64"
    >
      <defs>
        <linearGradient id="anthropicHeaderBadgeFill" x1="88" y1="30" x2="430" y2="486" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#EE9270" />
          <stop offset="0.42" stopColor="#D77655" />
          <stop offset="1" stopColor="#A94F38" />
        </linearGradient>
        <linearGradient id="anthropicHeaderMarkFill" x1="128" y1="72" x2="382" y2="430" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFDFB" />
          <stop offset="0.45" stopColor="#FCF2EE" />
          <stop offset="1" stopColor="#F2CDBF" />
        </linearGradient>
        <radialGradient id="anthropicHeaderGloss" cx="31%" cy="18%" r="62%">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.52" />
          <stop offset="0.38" stopColor="#FFFFFF" stopOpacity="0.2" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="anthropicHeaderInnerShadow" x1="96" y1="68" x2="420" y2="470" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.28" />
          <stop offset="1" stopColor="#4B1D12" stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <path
        fill="url(#anthropicHeaderBadgeFill)"
        d="M115.612 0h280.775C459.974 0 512 52.026 512 115.612v278.415c0 63.587-52.026 115.612-115.613 115.612H115.612C52.026 509.639 0 457.614 0 394.027V115.612C0 52.026 52.026 0 115.612 0z"
      />
      <path
        fill="url(#anthropicHeaderGloss)"
        d="M115.612 0h280.775C459.974 0 512 52.026 512 115.612v58.527C330.75 139.147 170.226 122.149 0 130.653v-15.041C0 52.026 52.026 0 115.612 0z"
      />
      <path
        fill="url(#anthropicHeaderMarkFill)"
        fillRule="nonzero"
        d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z"
      />
      <path
        fill="none"
        stroke="url(#anthropicHeaderInnerShadow)"
        strokeWidth="14"
        d="M115.612 7h280.775C456.11 7 505 55.89 505 115.612v278.415c0 59.723-48.89 108.612-108.613 108.612H115.612C55.89 502.639 7 453.75 7 394.027V115.612C7 55.89 55.89 7 115.612 7z"
      />
    </svg>
  );
}
