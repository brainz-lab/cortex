import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="flash"
export default class extends Controller {
  connect() {
    // Auto-dismiss after 5 seconds
    this.timeout = setTimeout(() => {
      this.dismiss()
    }, 5000)
  }

  disconnect() {
    if (this.timeout) {
      clearTimeout(this.timeout)
    }
  }

  dismiss(event) {
    if (event) {
      event.preventDefault()
      // Find the closest alert element from the button
      const alert = event.target.closest('.alert')
      if (alert) {
        this.fadeOut(alert)
        return
      }
    }

    // Fade out all alerts in this controller
    this.element.querySelectorAll('.alert').forEach(alert => {
      this.fadeOut(alert)
    })
  }

  fadeOut(element) {
    element.style.transition = 'opacity 0.2s ease-out, transform 0.2s ease-out'
    element.style.opacity = '0'
    element.style.transform = 'translateX(10px)'

    setTimeout(() => {
      element.remove()
      // If no more alerts, remove the container
      if (this.element.children.length === 0) {
        this.element.remove()
      }
    }, 200)
  }
}
