/// Isotipo (el clip) extraido del logo completo en /logo/logo_final.svg.
/// Inline (no next/image) para poder colorearlo con className via currentColor.
export function IsotipoGanchito({ className }: { className?: string }) {
  return (
    <svg
      viewBox="3660 0 1030 933"
      className={className}
      role="img"
      aria-label="Ganchito Estudio"
    >
      <path
        fill="currentColor"
        d="M4116 630l105 -63c1,-1 2,-2 3,-2l185 -111c28,-17 64,-8 81,20 17,28 8,64 -20,81l-188 113 -110 67 0 0 -1 0 -30 15 -1 1c-102,41 -220,1 -277,-93 -56,-94 -37,-216 47,-287l1 -1 28 -20 1 0 0 0c95,-57 189,-114 284,-172l0 0 29 -15 1 -1c142,-64 311,-12 391,121 77,127 52,289 -56,387l-75 52 -257 155 0 0 0 0 -29 15 0 1c-83,40 -177,50 -266,28 -101,-25 -187,-88 -240,-177 -105,-173 -60,-398 104,-517l0 -1 28 -18 1 0 109 -66c1,-1 3,-2 4,-2l218 -132 0 0c28,-16 64,-7 81,21 17,28 8,64 -20,81l0 0 -221 133 -110 66 0 0 0 0c-129,78 -170,245 -93,373 78,128 245,170 373,93l0 0 284 -171c89,-54 118,-170 64,-260 -54,-89 -170,-118 -259,-64l-28 17 -256 154 0 0c-50,30 -66,96 -36,146 30,50 95,66 145,36l6 -3z"
      />
    </svg>
  );
}
