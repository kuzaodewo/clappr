// Copyright 2014 Globo.com Player authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

import { isNumber, Fullscreen, DomRecycler } from '../../base/utils'

import Styler from '../../base/styler'
import Events from '../../base/events'
import UIObject from '../../base/ui_object'
import UICorePlugin from '../../base/ui_core_plugin'
import Browser from '../../components/browser'
import ContainerFactory from '../../components/container_factory'
import Mediator from '../../components/mediator'
import PlayerInfo from '../../components/player_info'
import PlayerError from '../../components/error'
import ErrorMixin from '../../base/error_mixin'

import $ from 'clappr-zepto'

import './public/style.scss'
import fontStyle from './public/fonts.css'

let style

/**
 * The Core is responsible to manage Containers, the mediator, MediaControl
 * and the player state.
 * @class Core
 * @constructor
 * @extends UIObject
 * @module components
 */
export default class Core extends UIObject {
  get events() {
    return {
      'webkitfullscreenchange': 'handleFullscreenChange',
      'mousemove': 'showMediaControl',
      'mouseleave': 'hideMediaControl'
    }
  }

  get attributes() {
    return {
      'data-player': '',
      tabindex: 9999
    }
  }

  /**
   * checks if the core is ready.
   * @property isReady
   * @type {Boolean} `true` if the core is ready, otherwise `false`
   */
  get isReady() {
    return !!this.ready
  }

  /**
   * The internationalization plugin.
   * @property i18n
   * @type {Strings}
   */
  get i18n() {
    return this.getPlugin('strings') || { t: (key) => key }
  }

  get mediaControl() {
    return this.getPlugin('media_control') || this.dummyMediaControl
  }

  get dummyMediaControl() {
    return new UICorePlugin(this)
  }

  /**
   * gets the active container reference.
   * @property activeContainer
   * @type {Object}
   */
  get activeContainer() {
    return this._activeContainer
  }

  /**
   * sets the active container reference and trigger a event with the new reference.
   * @property activeContainer
   * @type {Object}
   */
  set activeContainer(container) {
    this._activeContainer = container
    this.trigger(Events.CORE_ACTIVE_CONTAINER_CHANGED, this._activeContainer)
  }

  /**
   * gets the active playback reference.
   * @property activePlayback
   * @type {Object}
   */
  get activePlayback() {
    return this.activeContainer && this.activeContainer.playback
  }

  constructor(options) {
    super(options)
    this.playerError = new PlayerError(options, this)
    this.configureDomRecycler()
    this.playerInfo = PlayerInfo.getInstance(options.playerId)
    this.firstResize = true
    this.plugins = []
    this.containers = []
    //FIXME fullscreen api sucks
    this._boundFullscreenHandler = () => this.handleFullscreenChange()
    $(document).bind('fullscreenchange', this._boundFullscreenHandler)
    $(document).bind('MSFullscreenChange', this._boundFullscreenHandler)
    $(document).bind('mozfullscreenchange', this._boundFullscreenHandler)
    Browser.isMobile && $(window).bind('resize', (o) => { this.handleWindowResize(o) })
  }

  configureDomRecycler() {
    let recycleVideo = this.options && this.options.playback && this.options.playback.recycleVideo
    DomRecycler.configure({ recycleVideo })
  }

  createContainers(options) {
    this.defer = $.Deferred()
    this.defer.promise(this)
    this.containerFactory = new ContainerFactory(options, options.loader, this.i18n, this.playerError)
    this.prepareContainers()
  }

  prepareContainers() {
    this.containerFactory.createContainers()
      .then((containers) => this.setupContainers(containers))
      .then((containers) => this.resolveOnContainersReady(containers))
  }

  updateSize() {
    Fullscreen.isFullscreen() ? this.setFullscreen() : this.setPlayerSize()
  }

  setFullscreen() {
    if (!Browser.isiOS) {
      this.$el.addClass('fullscreen')
      this.$el.removeAttr('style')
      this.playerInfo.previousSize = { width: this.options.width, height: this.options.height }
      this.playerInfo.currentSize = { width: $(window).width(), height: $(window).height() }
    }
  }

  setPlayerSize() {
    this.$el.removeClass('fullscreen')
    this.playerInfo.currentSize = this.playerInfo.previousSize
    this.playerInfo.previousSize = { width: $(window).width(), height: $(window).height() }
    this.resize(this.playerInfo.currentSize)
  }

  resize(options) {
    if (!isNumber(options.height) && !isNumber(options.width))  {
      this.el.style.height = `${options.height}`
      this.el.style.width = `${options.width}`
    } else {
      this.el.style.height = `${options.height}px`
      this.el.style.width = `${options.width}px`
    }
    this.playerInfo.previousSize = { width: this.options.width, height: this.options.height }
    this.options.width = options.width
    this.options.height = options.height
    this.playerInfo.currentSize = options
    this.triggerResize(this.playerInfo.currentSize)
  }

  enableResizeObserver() {
    const checkSizeCallback = () => {
      if (this.playerInfo.computedSize.width !== this.el.clientWidth ||
          this.playerInfo.computedSize.height !== this.el.clientHeight) {
        this.playerInfo.computedSize = { width: this.el.clientWidth, height: this.el.clientHeight }
        this.triggerResize(this.playerInfo.computedSize)
      }
    }
    this.resizeObserverInterval = setInterval(checkSizeCallback, 500)
  }

  triggerResize(newSize) {
    const thereWasChange = this.firstResize || this.oldHeight !== newSize.height || this.oldWidth !== newSize.width
    if (thereWasChange) {
      Mediator.trigger(`${this.options.playerId}:${Events.PLAYER_RESIZE}`, newSize)
      this.oldHeight = newSize.height
      this.oldWidth = newSize.width
      this.firstResize = false
    }
  }

  disableResizeObserver() {
    this.resizeObserverInterval && clearInterval(this.resizeObserverInterval)
  }

  resolveOnContainersReady(containers) {
    $.when.apply($, containers).done(() => {
      this.defer.resolve(this)
      this.ready = true
      this.trigger(Events.CORE_READY)
    })
  }

  addPlugin(plugin) {
    this.plugins.push(plugin)
  }

  hasPlugin(name) {
    return !!this.getPlugin(name)
  }

  getPlugin(name) {
    return this.plugins.filter(plugin => plugin.name === name)[0]
  }

  load(sources, mimeType) {
    this.options.mimeType = mimeType
    sources = sources && sources.constructor === Array ? sources : [sources]
    this.options.sources = sources
    this.containers.forEach((container) => container.destroy())
    this.containerFactory.options = $.extend(this.options, { sources })
    this.prepareContainers()
  }

  destroy() {
    this.disableResizeObserver()
    this.containers.forEach((container) => container.destroy())
    this.plugins.forEach((plugin) => {
      plugin.destroy ? plugin.destroy() : plugin.remove()
    })
    this.$el.remove()
    $(document).unbind('fullscreenchange', this._boundFullscreenHandler)
    $(document).unbind('MSFullscreenChange', this._boundFullscreenHandler)
    $(document).unbind('mozfullscreenchange', this._boundFullscreenHandler)
    this.stopListening()
  }

  handleFullscreenChange() {
    this.trigger(Events.CORE_FULLSCREEN, Fullscreen.isFullscreen())
    this.updateSize()
  }

  handleWindowResize(event) {
    let orientation = ($(window).width() > $(window).height()) ? 'landscape' : 'portrait'
    if (this._screenOrientation === orientation) return
    this._screenOrientation = orientation
    let data = { event: event, orientation: this._screenOrientation }
    this.trigger(Events.CORE_SCREEN_ORIENTATION_CHANGED, data)
  }

  removeContainer(container) {
    this.stopListening(container)
    this.containers = this.containers.filter((c) => c !== container)
  }

  setupContainer(container) {
    this.listenTo(container, Events.CONTAINER_DESTROYED, this.removeContainer)
    this.containers.push(container)
  }

  setupContainers(containers) {
    containers.forEach(this.setupContainer.bind(this))
    this.trigger(Events.CORE_CONTAINERS_CREATED)
    this.renderContainers()
    this.activeContainer = containers[0]
    this.setupMediaControl()
    this.render()
    this.appendToParent()
    return this.containers
  }

  renderContainers() {
    this.containers.forEach((container) => this.el.appendChild(container.render().el))
  }

  createContainer(source, options) {
    const container = this.containerFactory.createContainer(source, options)
    this.setupContainer(container)
    this.el.appendChild(container.render().el)
    return container
  }

  setupMediaControl() {
    if (this.mediaControl) {
      this.listenTo(this.mediaControl, Events.MEDIACONTROL_FULLSCREEN, this.toggleFullscreen)
      this.listenTo(this.mediaControl, Events.MEDIACONTROL_SHOW, this.onMediaControlShow.bind(this, true))
      this.listenTo(this.mediaControl, Events.MEDIACONTROL_HIDE, this.onMediaControlShow.bind(this, false))
    }
  }

  /**
   * @deprecated
   * This method currently exists for retrocompatibility reasons.
   * If you want the current container reference, use the activeContainer getter.
   */
  getCurrentContainer() {
    return this.activeContainer
  }

  /**
   * @deprecated
   * This method currently exists for retrocompatibility reasons.
   * If you want the current playback reference, use the activePlayback getter.
   */
  getCurrentPlayback() {
    return this.activePlayback
  }

  getPlaybackType() {
    return this.activeContainer && this.activeContainer.getPlaybackType()
  }

  toggleFullscreen() {
    if (!Fullscreen.isFullscreen()) {
      Fullscreen.requestFullscreen(this.el)
      !Browser.isiOS && this.$el.addClass('fullscreen')
    } else {
      Fullscreen.cancelFullscreen()
      !Browser.isiOS && this.$el.removeClass('fullscreen nocursor')
    }
    this.mediaControl.show()
  }

  showMediaControl(event) {
    this.mediaControl.show && this.mediaControl.show(event)
  }

  hideMediaControl() {
    this.mediaControl.hide && this.mediaControl.hide(this.options.hideMediaControlDelay)
  }

  onMediaControlShow(showing) {
    let visibilityEvent = showing ? Events.CONTAINER_MEDIACONTROL_SHOW : Events.CONTAINER_MEDIACONTROL_HIDE
    this.activeContainer.trigger(visibilityEvent)
    showing && this.$el.removeClass('nocursor')
    Fullscreen.isFullscreen() && this.$el.addClass('nocursor')
  }

  /**
   * enables to configure the container after its creation
   * @method configure
   * @param {Object} options all the options to change in form of a javascript object
   */
  configure(options) {
    this._options = $.extend(this._options, options)
    this.configureDomRecycler()

    const sources = options.source || options.sources
    sources && this.load(sources, options.mimeType || this.options.mimeType)

    this.trigger(Events.CORE_OPTIONS_CHANGE)
    this.containers.forEach((container) => container.configure(this.options))
    this.mediaControl.configure && this.mediaControl.configure(this.options)
  }

  appendToParent() {
    let hasCoreParent = this.$el.parent() && this.$el.parent().length
    !hasCoreParent && this.$el.appendTo(this.options.parentElement)
  }

  render() {
    this.mediaControl && this.$el.append(this.mediaControl.render().el)

    if (!style)
      style = Styler.getStyleFor(fontStyle, { baseUrl: this.options.baseUrl })

    $('head').append(style)

    this.options.width = this.options.width || this.$el.width()
    this.options.height = this.options.height || this.$el.height()
    const size = { width: this.options.width, height: this.options.height }
    this.playerInfo.previousSize = this.playerInfo.currentSize = this.playerInfo.computedSize = size
    this.updateSize()

    this.previousSize = { width: this.$el.width(), height: this.$el.height() }

    this.enableResizeObserver()

    return this
  }
}

Object.assign(Core.prototype, ErrorMixin)
