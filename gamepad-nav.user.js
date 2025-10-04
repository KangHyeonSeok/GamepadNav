// ==UserScript==
// @name         🎮 게임패드 네비게이션
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  게임패드로 웹사이트 네비게이션 (L1/L2: 페이지 이동, 스틱: 스크롤)
// @author       Hskang
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @updateURL    http://192.168.45.166:8080/gamepad-nav.meta.js
// @downloadURL  http://192.168.45.166:8080/gamepad-nav.user.js
// ==/UserScript==

(function() {
    'use strict';

    // 토스트 스타일 추가
    const style = document.createElement('style');
    style.textContent = `
        .gamepad-toast {
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #6f42c1, #e83e8c);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            font-weight: bold;
            transform: translateX(100%);
            transition: transform 0.3s ease-in-out, opacity 0.3s ease;
            max-width: 280px;
            border-left: 4px solid #00ff88;
            opacity: 0;
            pointer-events: none;
        }
        
        .gamepad-toast.show {
            transform: translateX(0);
            opacity: 1;
        }
        
        .status-dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 6px;
        }
        
        .connected { background: #28a745; }
        .disconnected { background: #dc3545; }
        
        .gamepad-toggle {
            position: fixed;
            top: 20px;
            left: 20px;
            background: rgba(0,0,0,0.8);
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 20px;
            font-size: 12px;
            cursor: pointer;
            z-index: 999997;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            transition: background 0.3s ease;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .gamepad-toggle:hover {
            background: rgba(0,0,0,0.9);
        }
        
        .gamepad-toggle.connected {
            background: rgba(40, 167, 69, 0.8);
        }
        
        .gamepad-toggle.connected:hover {
            background: rgba(40, 167, 69, 0.9);
        }
        
        .gamepad-toggle.disabled {
            background: rgba(100,100,100,0.8);
            cursor: not-allowed;
        }
    `;
    
    // DOM이 로드되면 스타일 추가
    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            document.head.appendChild(style);
        });
    }

    let gamepadCount = 0;
    let isEnabled = true;
    let toggleButton = null;
    let lastStickState = { up: false, down: false, left: false, right: false };
    let lastButtonState = { leftShoulder: false, leftTrigger: false };
    let stickCooldown = { up: 0, down: 0 };
    let buttonCooldown = { leftShoulder: 0, leftTrigger: 0 };
    let scrollInterval = null;
    const STICK_THRESHOLD = 0.7; // 스틱 감도
    const BUTTON_THRESHOLD = 0.5; // 버튼 감도
    const COOLDOWN_TIME = 1000; // 1초 쿨다운
    const SCROLL_SPEED = 15; // 스크롤 속도 (픽셀) - 더 빠르게
    const SCROLL_INTERVAL = 16; // 60fps (16ms)
    const PAGE_SCROLL_SPEED = window.innerHeight * 0.8; // 페이지업/다운 크기

    // 토스트 표시 함수
    function showToast(message, duration = 2000) {
        if (!isEnabled) return;
        
        // 기존 토스트 제거
        const existingToasts = document.querySelectorAll('.gamepad-toast');
        existingToasts.forEach(toast => toast.remove());
        
        // 새 토스트 생성
        const toast = document.createElement('div');
        toast.className = 'gamepad-toast';
        toast.innerHTML = `🎮 ${message}`;
        
        document.body.appendChild(toast);
        
        // 애니메이션
        setTimeout(() => toast.classList.add('show'), 100);
        
        // 자동 제거
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.remove('show');
                setTimeout(() => {
                    if (toast.parentElement) {
                        toast.remove();
                    }
                }, 300);
            }
        }, duration);
    }

    // navigation_buttons.js 기반 다음화 버튼 찾기
    function findNextButton() {
        console.log('🔍 다음화 버튼 검색 시작...');
        
        // 텍스트로 찾기
        const textSelectors = [
            '다음화', '다음 화', '다음편', '다음 편', 'next', 'Next',
            '→', '▶', '▷', '▶️', '다음', '다음글', '다음회'
        ];
        
        for (const text of textSelectors) {
            const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                const hasText = el.textContent && el.textContent.trim().includes(text);
                const isClickable = el.tagName === 'BUTTON' || el.tagName === 'A' || 
                                   el.tagName === 'DIV' || el.tagName === 'SPAN' ||
                                   el.onclick || el.getAttribute('onclick');
                const isVisible = el.offsetParent !== null;
                return hasText && isClickable && isVisible;
            });
            
            if (elements.length > 0) {
                const sortedElements = elements.sort((a, b) => {
                    const tagPriority = { 'A': 4, 'BUTTON': 3, 'SPAN': 2, 'DIV': 1 };
                    const aPriority = tagPriority[a.tagName] || 0;
                    const bPriority = tagPriority[b.tagName] || 0;
                    
                    if (aPriority !== bPriority) {
                        return bPriority - aPriority;
                    }
                    return a.textContent.trim().length - b.textContent.trim().length;
                });
                
                console.log(`✅ 다음화 버튼 찾음: ${sortedElements[0].textContent.trim()}`);
                return sortedElements[0];
            }
        }
        
        // 클래스나 ID로 찾기
        const classSelectors = [
            '.next', '.next-btn', '.next-button', '.btn-next',
            '.episode-next', '.chapter-next', '[class*="next"]'
        ];
        
        for (const selector of classSelectors) {
            const element = document.querySelector(selector);
            if (element && element.offsetParent !== null) {
                console.log(`✅ 다음화 버튼 찾음 (CSS): ${selector}`);
                return element;
            }
        }
        
        console.log('❌ 다음화 버튼을 찾을 수 없음');
        return null;
    }

    // navigation_buttons.js 기반 이전화 버튼 찾기
    function findPrevButton() {
        console.log('🔍 이전화 버튼 검색 시작...');
        
        // 텍스트로 찾기
        const textSelectors = [
            '이전화', '이전 화', '이전편', '이전 편', 'prev', 'Prev',
            '←', '◀', '◁', '◀️', '이전', '이전글', '이전회'
        ];
        
        for (const text of textSelectors) {
            const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                const hasText = el.textContent && el.textContent.trim().includes(text);
                const isClickable = el.tagName === 'BUTTON' || el.tagName === 'A' || 
                                   el.tagName === 'DIV' || el.tagName === 'SPAN' ||
                                   el.onclick || el.getAttribute('onclick');
                const isVisible = el.offsetParent !== null;
                return hasText && isClickable && isVisible;
            });
            
            if (elements.length > 0) {
                const sortedElements = elements.sort((a, b) => {
                    const tagPriority = { 'A': 4, 'BUTTON': 3, 'SPAN': 2, 'DIV': 1 };
                    const aPriority = tagPriority[a.tagName] || 0;
                    const bPriority = tagPriority[b.tagName] || 0;
                    
                    if (aPriority !== bPriority) {
                        return bPriority - aPriority;
                    }
                    return a.textContent.trim().length - b.textContent.trim().length;
                });
                
                console.log(`✅ 이전화 버튼 찾음: ${sortedElements[0].textContent.trim()}`);
                return sortedElements[0];
            }
        }
        
        // 클래스나 ID로 찾기
        const classSelectors = [
            '.prev', '.prev-btn', '.prev-button', '.btn-prev',
            '.episode-prev', '.chapter-prev', '[class*="prev"]'
        ];
        
        for (const selector of classSelectors) {
            const element = document.querySelector(selector);
            if (element && element.offsetParent !== null) {
                console.log(`✅ 이전화 버튼 찾음 (CSS): ${selector}`);
                return element;
            }
        }
        
        console.log('❌ 이전화 버튼을 찾을 수 없음');
        return null;
    }

    // 버튼 클릭 실행
    function clickButton(button, type) {
        if (!button) {
            showToast(`${type} 버튼을 찾을 수 없음`, 2000);
            return false;
        }
        
        console.log(`🎮 ${type} 버튼 클릭:`, button.textContent.trim());
        
        // 클릭 이벤트 시뮬레이션
        const rect = button.getBoundingClientRect();
        const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
        });
        
        button.dispatchEvent(clickEvent);
        
        if (button.click) {
            button.click();
        }
        
        showToast(`${type} 실행됨`, 1500);
        return true;
    }

    // 다음화로 이동
    function goNext() {
        const nextButton = findNextButton();
        return clickButton(nextButton, '다음화');
    }

    // 스크롤 제어 함수
    function startScroll(direction) {
        if (scrollInterval) return; // 이미 스크롤 중이면 무시
        
        const scrollAmount = direction === 'up' ? -SCROLL_SPEED : SCROLL_SPEED;
        
        scrollInterval = setInterval(() => {
            window.scrollBy(0, scrollAmount);
        }, SCROLL_INTERVAL);
    }
    
    // 페이지 스크롤 (페이지업/다운)
    function pageScroll(direction) {
        const scrollAmount = direction === 'up' ? -PAGE_SCROLL_SPEED : PAGE_SCROLL_SPEED;
        window.scrollBy({
            top: scrollAmount,
            behavior: 'smooth'
        });
    }
    
    function stopScroll() {
        if (scrollInterval) {
            clearInterval(scrollInterval);
            scrollInterval = null;
        }
    }

    // 게임패드 상태 업데이트 (NAV 버튼에 표시)
    function updateGamepadStatus() {
        if (!toggleButton) return;
        
        const gamepads = navigator.getGamepads();
        const connected = Array.from(gamepads).filter(g => g).length;
        
        if (connected > 0) {
            toggleButton.classList.add('connected');
            toggleButton.innerHTML = `<span class="status-dot connected"></span>NAV (${connected})`;
        } else {
            toggleButton.classList.remove('connected');
            toggleButton.innerHTML = `<span class="status-dot disconnected"></span>NAV`;
        }
        
        // 비활성화 상태 처리
        if (!isEnabled) {
            toggleButton.classList.add('disabled');
            if (connected > 0) {
                toggleButton.innerHTML = `<span class="status-dot connected"></span>OFF (${connected})`;
            } else {
                toggleButton.innerHTML = `<span class="status-dot disconnected"></span>OFF`;
            }
        } else {
            toggleButton.classList.remove('disabled');
        }
    }

    // 이전화로 이동
    function goPrev() {
        const prevButton = findPrevButton();
        return clickButton(prevButton, '이전화');
    }

    // 게임패드 왼쪽 스틱 및 버튼 입력 감지
    function checkGamepadInput() {
        if (!isEnabled) return;
        
        const gamepads = navigator.getGamepads();
        const connectedGamepads = Array.from(gamepads).filter(g => g);
        
        // 게임패드 연결 상태 변경 감지
        if (connectedGamepads.length !== gamepadCount) {
            if (connectedGamepads.length > gamepadCount) {
                showToast('게임패드 연결됨!', 2000);
            } else if (gamepadCount > 0) {
                showToast('게임패드 해제됨', 2000);
            }
            gamepadCount = connectedGamepads.length;
            updateGamepadStatus();
        }
        
        // 입력 감지
        connectedGamepads.forEach((gamepad, gamepadIndex) => {
            const leftStickX = gamepad.axes[0]; // X축 (좌/우)
            const leftStickY = gamepad.axes[1]; // Y축 (위/아래)
            const leftShoulder = gamepad.buttons[4] ? gamepad.buttons[4].pressed : false; // L1
            const leftTrigger = gamepad.buttons[6] ? gamepad.buttons[6].value > BUTTON_THRESHOLD : false; // L2
            const now = Date.now();
            
            // Left Shoulder (L1) - 다음화
            if (leftShoulder && !lastButtonState.leftShoulder && now > buttonCooldown.leftShoulder) {
                console.log('🎮 L1 버튼: 다음화');
                goNext();
                buttonCooldown.leftShoulder = now + COOLDOWN_TIME;
            }
            lastButtonState.leftShoulder = leftShoulder;
            
            // Left Trigger (L2) - 이전화
            if (leftTrigger && !lastButtonState.leftTrigger && now > buttonCooldown.leftTrigger) {
                console.log('🎮 L2 버튼: 이전화');
                goPrev();
                buttonCooldown.leftTrigger = now + COOLDOWN_TIME;
            }
            lastButtonState.leftTrigger = leftTrigger;
            
            // 위쪽 스틱 (페이지다운) - Y축
            const stickUp = leftStickY < -STICK_THRESHOLD;
            if (stickUp && !lastStickState.up && now > stickCooldown.up) {
                console.log('🎮 왼쪽 스틱 위: 페이지다운');
                pageScroll('down');
                stickCooldown.up = now + COOLDOWN_TIME;
            }
            lastStickState.up = stickUp;
            
            // 아래쪽 스틱 (페이지업) - Y축
            const stickDown = leftStickY > STICK_THRESHOLD;
            if (stickDown && !lastStickState.down && now > stickCooldown.down) {
                console.log('🎮 왼쪽 스틱 아래: 페이지업');
                pageScroll('up');
                stickCooldown.down = now + COOLDOWN_TIME;
            }
            lastStickState.down = stickDown;
            
            // 왼쪽 스틱 (위로 스크롤) - X축
            const stickLeft = leftStickX < -STICK_THRESHOLD;
            if (stickLeft && !lastStickState.left) {
                console.log('🎮 왼쪽 스틱 좌: 위로 스크롤 시작');
                startScroll('up');
            } else if (!stickLeft && lastStickState.left) {
                console.log('🎮 왼쪽 스틱 좌: 스크롤 중단');
                stopScroll();
            }
            lastStickState.left = stickLeft;
            
            // 오른쪽 스틱 (아래로 스크롤) - X축
            const stickRight = leftStickX > STICK_THRESHOLD;
            if (stickRight && !lastStickState.right) {
                console.log('🎮 왼쪽 스틱 우: 아래로 스크롤 시작');
                startScroll('down');
            } else if (!stickRight && lastStickState.right) {
                console.log('🎮 왼쪽 스틱 우: 스크롤 중단');
                stopScroll();
            }
            lastStickState.right = stickRight;
        });
    }

    // UI 요소 생성
    function createUI() {        
        // 토글 버튼 (게임패드 상태 통합)
        toggleButton = document.createElement('button');
        toggleButton.className = 'gamepad-toggle';
        toggleButton.innerHTML = '<span class="status-dot disconnected"></span>NAV';
        toggleButton.onclick = () => {
            isEnabled = !isEnabled;
            showToast(isEnabled ? '네비게이션 활성화' : '네비게이션 비활성화', 1500);
            updateGamepadStatus(); // 상태 즉시 업데이트
        };
        document.body.appendChild(toggleButton);
        
        // 초기 상태 설정
        updateGamepadStatus();
    }

    // 초기화
    function init() {
        // PostMessage 수신 (PWA 브리지용)
        window.addEventListener('message', (event) => {
            if (event.data.type === 'GAMEPAD_UPDATE' && isEnabled) {
                const gamepads = event.data.gamepads;
                
                // 게임패드 연결 상태 변경 감지
                if (gamepads.length !== gamepadCount) {
                    if (gamepads.length > gamepadCount) {
                        showToast('게임패드 연결됨! (PWA)', 2000);
                    } else if (gamepadCount > 0) {
                        showToast('게임패드 해제됨 (PWA)', 2000);
                    }
                    gamepadCount = gamepads.length;
                }
                
                // 왼쪽 스틱 입력 감지 (PWA 브리지)
                gamepads.forEach((gamepad, gamepadIndex) => {
                    const leftStickX = gamepad.axes[0]; // X축 (좌/우)
                    const leftStickY = gamepad.axes[1]; // Y축 (위/아래)
                    const now = Date.now();
                    
                    // 위쪽 스틱 (다음화) - Y축
                    const stickUp = leftStickY < -STICK_THRESHOLD;
                    if (stickUp && !lastStickState.up && now > stickCooldown.up) {
                        console.log('🎮 PWA 왼쪽 스틱 위: 다음화');
                        goNext();
                        stickCooldown.up = now + COOLDOWN_TIME;
                    }
                    lastStickState.up = stickUp;
                    
                    // 아래쪽 스틱 (이전화) - Y축
                    const stickDown = leftStickY > STICK_THRESHOLD;
                    if (stickDown && !lastStickState.down && now > stickCooldown.down) {
                        console.log('🎮 PWA 왼쪽 스틱 아래: 이전화');
                        goPrev();
                        stickCooldown.down = now + COOLDOWN_TIME;
                    }
                    lastStickState.down = stickDown;
                    
                    // 왼쪽 스틱 (위로 스크롤) - X축
                    const stickLeft = leftStickX < -STICK_THRESHOLD;
                    if (stickLeft && !lastStickState.left) {
                        console.log('🎮 PWA 왼쪽 스틱 좌: 위로 스크롤 시작');
                        startScroll('up');
                    } else if (!stickLeft && lastStickState.left) {
                        console.log('🎮 PWA 왼쪽 스틱 좌: 스크롤 중단');
                        stopScroll();
                    }
                    lastStickState.left = stickLeft;
                    
                    // 오른쪽 스틱 (아래로 스크롤) - X축
                    const stickRight = leftStickX > STICK_THRESHOLD;
                    if (stickRight && !lastStickState.right) {
                        console.log('🎮 PWA 왼쪽 스틱 우: 아래로 스크롤 시작');
                        startScroll('down');
                    } else if (!stickRight && lastStickState.right) {
                        console.log('🎮 PWA 왼쪽 스틱 우: 스크롤 중단');
                        stopScroll();
                    }
                    lastStickState.right = stickRight;
                });
            }
        });
        
        // 게임패드 이벤트
        window.addEventListener('gamepadconnected', (e) => {
            if (isEnabled) {
                showToast(`게임패드 연결: ${e.gamepad.id}`, 2000);
            }
            updateGamepadStatus();
        });
        
        window.addEventListener('gamepaddisconnected', (e) => {
            if (isEnabled) {
                showToast(`게임패드 해제: ${e.gamepad.id}`, 2000);
            }
            updateGamepadStatus();
        });
        
        // 주기적 게임패드 체크
        setInterval(checkGamepadInput, 100);
        setInterval(updateGamepadStatus, 1000);
        
        console.log('🎮 게임패드 네비게이션 스크립트 활성화');
    }

    // DOM 로드 후 초기화
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(createUI, 1000);
            init();
        });
    } else {
        setTimeout(createUI, 1000);
        init();
    }

})();