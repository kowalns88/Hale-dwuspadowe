import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Header() {
  const { t } = useTranslation()

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-[#1a1a2e] border-b border-transparent">
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-accent-orange" />
        <h1 className="text-lg font-sans font-bold text-white tracking-wide">
          {t('app.title')}
        </h1>
        <span className="text-xs text-gray-300 font-sans hidden sm:inline">
          {t('app.subtitle')}
        </span>
      </div>
      <LanguageSwitcher />
    </header>
  )
}
