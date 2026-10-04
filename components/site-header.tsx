import Link from "next/link";
import BrandMark from "@/components/brand-mark";

export default function SiteHeader() {
  return <header className="site-header">
    <div className="shell header-inner">
      <Link className="brand" href="/" aria-label="บริการค่าจัดเก็บขยะ หน้าแรก">
        <BrandMark />
        <span className="brand-copy"><strong>ค่าจัดเก็บขยะ</strong><small>เทศบาลตำบลเหมืองหม้อ</small></span>
      </Link>
    </div>
  </header>;
}
