// 设备类型检测：手机 UA 或窄屏触摸设备视为移动端。
// 用于“桌面端展示扫码购买二维码、手机端不展示”这类场景。
export function useIsMobile() {
  const headers = useRequestHeaders(['user-agent'])
  const ua = headers['user-agent'] || ''
  const uaMobile = /Android|iPhone|iPad|iPod|Windows Phone|Mobile|Opera Mini|IEMobile/i.test(ua)

  const isMobile = ref(uaMobile)

  if (import.meta.client) {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => {
      // 手机 UA 或窄屏（含触摸）视为移动端
      isMobile.value = uaMobile || mq.matches || (navigator.maxTouchPoints > 0 && window.innerWidth <= 900)
    }
    update()
    mq.addEventListener('change', update)
    onBeforeUnmount(() => mq.removeEventListener('change', update))
  }

  return isMobile
}
